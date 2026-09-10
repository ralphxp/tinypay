import { Injectable } from '@nestjs/common';
import { Prisma, type JournalEntry, type JournalEntryKind, type Posting } from '@prisma/client';
import { PrismaService } from '../../infra/database/prisma.service.js';
import { LedgerImbalanceError } from '../../common/errors/domain-errors.js';
import { AccountService } from './account.service.js';
import { BalanceService } from './balance.service.js';
import { LimitsService } from './limits.service.js';
import type { AccountRef, CurrencyCode } from '../../shared/types/account.js';

export interface LedgerLeg {
  accountRef: AccountRef;
  /** Signed minor units: negative = debit, positive = credit. */
  amountMinor: bigint;
}

export interface PostEntryInput {
  /** Idempotency key — a ULID minted at FSM confirm time, or a PSP/webhook event id. */
  externalRef: string;
  kind: JournalEntryKind;
  legs: LedgerLeg[];
  currency?: CurrencyCode;
}

export interface PostedEntry {
  entry: JournalEntry;
  postings: Posting[];
}

// Account kinds that act as clearing accounts against the outside world and
// are allowed to go negative (they represent a counterparty, not real funds).
const CLEARING_KINDS = new Set(['psp_settlement', 'fees', 'revenue', 'suspense']);

@Injectable()
export class LedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountService,
    private readonly balances: BalanceService,
    private readonly limits: LimitsService,
  ) {}

  /**
   * Posts a balanced journal entry in one transaction: resolves each leg's
   * account, locks its cached balance (FOR UPDATE), enforces non-negative
   * wallet/pool balances and KYC tier caps on debits, then writes the entry,
   * postings, and updated balances. Idempotent on `externalRef` — replaying
   * the same ref returns the original entry instead of posting twice.
   */
  async postEntry(input: PostEntryInput): Promise<PostedEntry> {
    const { externalRef, kind, legs, currency = 'NGN' } = input;

    const sum = legs.reduce((total, leg) => total + leg.amountMinor, 0n);
    if (sum !== 0n) {
      throw new LedgerImbalanceError(
        `Journal entry ${externalRef} legs sum to ${sum}, expected 0`,
      );
    }

    const existing = await this.findByExternalRef(externalRef);
    if (existing) return existing;

    try {
      return await this.prisma.withTransaction(async (tx) => {
        const entry = await tx.journalEntry.create({
          data: { externalRef, kind, status: 'posted' },
        });

        const postings: Posting[] = [];
        for (const leg of legs) {
          const account = await this.accounts.resolveAccount(leg.accountRef, tx, currency);
          const currentBalance = await this.balances.lockForUpdate(account.id, tx);
          const projectedBalance = currentBalance + leg.amountMinor;

          if (leg.amountMinor < 0n && account.kind === 'wallet') {
            await this.limits.assertWithinLimits(
              {
                userId: account.ownerId,
                accountId: account.id,
                debitAmountMinor: -leg.amountMinor,
                projectedBalanceMinor: projectedBalance,
              },
              tx,
            );
          } else if (projectedBalance < 0n && !CLEARING_KINDS.has(account.kind)) {
            throw new LedgerImbalanceError(
              `Posting to ${account.kind} account ${account.id} would go negative`,
            );
          }

          const posting = await tx.posting.create({
            data: {
              entryId: entry.id,
              accountId: account.id,
              amountMinor: leg.amountMinor,
              currency,
            },
          });
          postings.push(posting);

          await this.balances.applyDelta(account.id, leg.amountMinor, tx);
        }

        return { entry, postings };
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const raced = await this.findByExternalRef(externalRef);
        if (raced) return raced;
      }
      throw err;
    }
  }

  private async findByExternalRef(externalRef: string): Promise<PostedEntry | null> {
    const entry = await this.prisma.journalEntry.findUnique({
      where: { externalRef },
      include: { postings: true },
    });
    if (!entry) return null;
    const { postings, ...rest } = entry;
    return { entry: rest, postings };
  }
}
