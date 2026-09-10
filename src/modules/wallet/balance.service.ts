import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, type PrismaTransactionClient } from '../../infra/database/prisma.service.js';

interface BalanceRow {
  amount_minor: bigint;
}

@Injectable()
export class BalanceService {
  constructor(private readonly prisma: PrismaService) {}

  /** Cached read — fine for display (e.g. the `balance` verb), not for a debit decision. */
  async getBalance(accountId: string): Promise<bigint> {
    const balance = await this.prisma.balance.findUnique({ where: { accountId } });
    return balance?.amountMinor ?? 0n;
  }

  /**
   * Locks the balance row for the remainder of the enclosing transaction and
   * returns its current value. Must be called inside the same transaction as
   * the posting that will change it (see LedgerService.postEntry).
   */
  async lockForUpdate(accountId: string, tx: PrismaTransactionClient): Promise<bigint> {
    const rows = await tx.$queryRaw<BalanceRow[]>(
      Prisma.sql`SELECT amount_minor FROM balances WHERE account_id = ${accountId} FOR UPDATE`,
    );
    return rows[0]?.amount_minor ?? 0n;
  }

  async applyDelta(accountId: string, delta: bigint, tx: PrismaTransactionClient): Promise<void> {
    await tx.balance.update({
      where: { accountId },
      data: { amountMinor: { increment: delta } },
    });
  }
}
