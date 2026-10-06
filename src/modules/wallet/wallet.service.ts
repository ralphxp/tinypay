import { Injectable } from '@nestjs/common';
import { Prisma, type Network, type Wallet, type WalletTransaction } from '@prisma/client';
import { PrismaService } from '../../infra/database/prisma.service.js';
import { InsufficientBalanceError } from '../../common/errors/domain-errors.js';

export interface ReserveFundInput {
  userId: string;
  /** Idempotency ref — unique on wallet_transactions.ref. The exact value also sent to Paystack as `reference`. */
  ref: string;
  amountMinor: bigint;
}

export interface ReserveDebitInput {
  userId: string;
  /** Idempotency ref — unique on wallet_transactions.ref (an internal ULID). */
  ref: string;
  amountMinor: bigint;
  type: 'airtime' | 'data';
  network: Network;
  recipientPhone: string;
  planCode?: string;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * Money itself lives in Paystack (funding) and is spent via Bigisub
 * (airtime/data) — this is bookkeeping, not custody. Single-sided (no
 * double-entry chart of accounts): there's no second party's books to keep
 * without P2P transfers, so a cached balance on `wallets` + an append-only
 * `wallet_transactions` log is enough, as long as every balance mutation
 * happens in the same DB transaction as the row that justifies it.
 */
@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreateWallet(userId: string): Promise<Wallet> {
    return this.prisma.wallet.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  async getBalance(userId: string): Promise<bigint> {
    const wallet = await this.getOrCreateWallet(userId);
    return wallet.balanceMinor;
  }

  listTransactions(userId: string, limit = 10): Promise<WalletTransaction[]> {
    return this.prisma.walletTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Reserves a pending funding transaction BEFORE the user is sent to
   * Paystack's checkout page — `ref` is the exact value later sent back on
   * the `charge.success` webhook, which is how completeFund() below finds
   * which user/amount to credit (no Paystack customer-code lookup needed:
   * the reference itself is the join key). Idempotent on `ref`.
   */
  async reserveFund(input: ReserveFundInput): Promise<{ transactionId: string }> {
    const wallet = await this.getOrCreateWallet(input.userId);
    try {
      const txn = await this.prisma.walletTransaction.create({
        data: {
          ref: input.ref,
          walletId: wallet.id,
          userId: input.userId,
          type: 'fund',
          amountMinor: input.amountMinor,
          status: 'pending',
        },
      });
      return { transactionId: txn.id };
    } catch (err) {
      if (isUniqueViolation(err)) {
        const existing = await this.prisma.walletTransaction.findUniqueOrThrow({ where: { ref: input.ref } });
        return { transactionId: existing.id };
      }
      throw err;
    }
  }

  /**
   * Completes a funding transaction once Paystack's `charge.success`
   * webhook confirms payment — credits the wallet in the same DB
   * transaction as the status flip. Idempotent: a redelivered webhook for
   * an already-completed ref is a no-op. Returns null for a ref this app
   * never reserved (nothing to credit, nobody to notify).
   */
  async completeFund(ref: string, providerRef: string): Promise<{ userId: string; amountMinor: bigint } | null> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.walletTransaction.updateMany({
        where: { ref, status: 'pending' },
        data: { status: 'completed', providerRef },
      });
      if (result.count === 0) return null;

      const txn = await tx.walletTransaction.findUniqueOrThrow({ where: { ref } });
      await tx.wallet.update({
        where: { id: txn.walletId },
        data: { balanceMinor: { increment: txn.amountMinor } },
      });
      return { userId: txn.userId, amountMinor: txn.amountMinor };
    });
  }

  /**
   * Reserves a debit for a purchase BEFORE calling the biller — balance-
   * before-provider, same discipline the old ledger-before-PSP payout flow
   * used. The balance decrement is a single atomic, WHERE-guarded UPDATE (no
   * negative balance possible under concurrent debits, no separate row lock
   * needed); the WalletTransaction insert happens in the same DB transaction,
   * so a thrown InsufficientBalanceError (or a lost ref race, below) rolls
   * the decrement back too. Idempotent on `ref`: a retried call for the same
   * ref returns the already-reserved transaction rather than debiting twice.
   */
  async reserveDebit(input: ReserveDebitInput): Promise<{ transactionId: string; alreadyReserved: boolean }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const wallet = await tx.wallet.upsert({
          where: { userId: input.userId },
          create: { userId: input.userId },
          update: {},
        });

        const updated = await tx.$executeRaw`
          UPDATE wallets SET balance_minor = balance_minor - ${input.amountMinor}
          WHERE id = ${wallet.id} AND balance_minor >= ${input.amountMinor}
        `;
        if (updated === 0) {
          throw new InsufficientBalanceError();
        }

        const txn = await tx.walletTransaction.create({
          data: {
            ref: input.ref,
            walletId: wallet.id,
            userId: input.userId,
            type: input.type,
            amountMinor: input.amountMinor,
            status: 'pending',
            network: input.network,
            recipientPhone: input.recipientPhone,
            planCode: input.planCode,
          },
        });
        return { transactionId: txn.id, alreadyReserved: false };
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        const existing = await this.prisma.walletTransaction.findUniqueOrThrow({ where: { ref: input.ref } });
        return { transactionId: existing.id, alreadyReserved: true };
      }
      throw err;
    }
  }

  /** Idempotent: a repeat call against an already-settled transaction is a no-op. */
  async markCompleted(transactionId: string, providerRef: string): Promise<void> {
    await this.prisma.walletTransaction.updateMany({
      where: { id: transactionId, status: 'pending' },
      data: { status: 'completed', providerRef },
    });
  }

  /**
   * Refunds a reserved debit whose biller call failed — the balance was
   * already taken by reserveDebit(), so failing the purchase must give it
   * back. Idempotent: `updateMany`'s WHERE guard (status still 'pending')
   * means a retried call against an already-failed (or already-completed)
   * transaction is a no-op, never a double refund.
   */
  async refundFailed(transactionId: string, reason: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.walletTransaction.updateMany({
        where: { id: transactionId, status: 'pending' },
        data: { status: 'failed', failureReason: reason },
      });
      if (result.count === 0) return;

      const txn = await tx.walletTransaction.findUniqueOrThrow({ where: { id: transactionId } });
      await tx.wallet.update({
        where: { id: txn.walletId },
        data: { balanceMinor: { increment: txn.amountMinor } },
      });
    });
  }
}
