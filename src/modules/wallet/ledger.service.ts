import { Injectable } from '@nestjs/common';
import { Prisma, type JournalEntry, type JournalEntryKind, type Posting } from '@prisma/client';
import { PrismaService } from '../../infra/database/prisma.service.js';
import {
  LedgerEntryNotFoundError,
  LedgerImbalanceError,
} from '../../common/errors/domain-errors.js';
import { AccountService } from './account.service.js';
import { BalanceService } from './balance.service.js';
import { LimitsService } from './limits.service.js';
import type { AccountRef, CurrencyCode } from '../../shared/types/account.js';

export interface LedgerLeg {
  accountRef: AccountRef;
  /** Signed minor units: negative = debit, positive = credit. */
  amountMinor: bigint;
  /** Pool-attribution tags (contribute/disburse legs only) — see prisma/schema.prisma postings. */
  groupId?: string;
  roundId?: string;
  memberId?: string;
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
  /** True when this call returned an entry that was already posted (same externalRef). */
  replayed?: boolean;
}

// Account kinds that act as clearing accounts against the outside world and
// are allowed to go negative (they represent a counterparty, not real funds).
const CLEARING_KINDS = new Set(['psp_settlement', 'fees', 'revenue', 'suspense']);

const REVERSAL_PREFIX = 'reverse:';

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
   * wallet/pool balances and KYC tier caps, then writes the entry,
   * postings, and updated balances. Idempotent on `externalRef` — replaying
   * the same ref returns the original entry (with `replayed: true`) instead
   * of posting twice.
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
    if (existing) return { ...existing, replayed: true };

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

          if (account.kind === 'wallet') {
            await this.limits.assertWithinLimits(
              {
                userId: account.ownerId,
                accountId: account.id,
                debitAmountMinor: leg.amountMinor < 0n ? -leg.amountMinor : undefined,
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
              groupId: leg.groupId,
              roundId: leg.roundId,
              memberId: leg.memberId,
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
        if (raced) return { ...raced, replayed: true };
      }
      throw err;
    }
  }

  /**
   * Posts the exact inverse of a previously posted entry — history is
   * append-only, so corrections are new entries, never mutations of the
   * original. Idempotent on the derived ref `reverse:{originalRef}`, same as
   * postEntry itself.
   */
  async reverse(originalRef: string): Promise<PostedEntry> {
    const reversalRef = `${REVERSAL_PREFIX}${originalRef}`;

    const existingReversal = await this.findByExternalRef(reversalRef);
    if (existingReversal) return { ...existingReversal, replayed: true };

    const original = await this.findByExternalRef(originalRef);
    if (!original) {
      throw new LedgerEntryNotFoundError(`No journal entry found for ref ${originalRef}`);
    }

    const accountIds = [...new Set(original.postings.map((p) => p.accountId))];
    const accounts = await this.prisma.account.findMany({ where: { id: { in: accountIds } } });
    const accountById = new Map(accounts.map((a) => [a.id, a]));

    const legs: LedgerLeg[] = original.postings.map((posting) => {
      const account = accountById.get(posting.accountId);
      if (!account) {
        throw new LedgerEntryNotFoundError(
          `Account ${posting.accountId} referenced by ${originalRef} no longer exists`,
        );
      }
      return {
        accountRef: { ownerType: account.ownerType, ownerId: account.ownerId, kind: account.kind },
        amountMinor: -posting.amountMinor,
        groupId: posting.groupId ?? undefined,
        roundId: posting.roundId ?? undefined,
        memberId: posting.memberId ?? undefined,
      };
    });

    const reversal = await this.postEntry({
      externalRef: reversalRef,
      kind: 'reversal',
      legs,
      currency: original.postings[0]?.currency as CurrencyCode | undefined,
    });

    await this.prisma.journalEntry.update({
      where: { id: original.entry.id },
      data: { status: 'reversed' },
    });

    return reversal;
  }

  private async findByExternalRef(externalRef: string): Promise<Omit<PostedEntry, 'replayed'> | null> {
    const entry = await this.prisma.journalEntry.findUnique({
      where: { externalRef },
      include: { postings: true },
    });
    if (!entry) return null;
    const { postings, ...rest } = entry;
    return { entry: rest, postings };
  }
}
