import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TierLimitError } from '../../common/errors/domain-errors.js';
import type { PrismaTransactionClient } from '../../infra/database/prisma.service.js';

// Single source of truth for "today" in daily-cap accounting (guiding
// principle #10: caps enforced in the ledger, not in copy). Every date-math
// expression in checkDaily must go through this constant, not a literal.
const LEDGER_TIMEZONE = 'Africa/Lagos';

interface DailyDebitRow {
  total: bigint | null;
}

export interface LimitCheckInput {
  userId: string;
  accountId: string;
  /**
   * Positive magnitude of an outgoing debit. Omit for a credit leg (funding)
   * — the single-txn and daily caps only apply to money leaving the wallet;
   * the balance cap and overdraw check below still run either way.
   */
  debitAmountMinor?: bigint;
  /** The wallet's balance after this leg would apply. */
  projectedBalanceMinor: bigint;
}

@Injectable()
export class LimitsService {
  /** Enforces the actor's KYC tier caps at post time — never in copy (guiding principle #10). */
  async assertWithinLimits(input: LimitCheckInput, tx: PrismaTransactionClient): Promise<void> {
    const { userId, accountId, debitAmountMinor, projectedBalanceMinor } = input;

    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const tier = await tx.kycTier.findUniqueOrThrow({ where: { tier: user.kycTier } });

    if (debitAmountMinor !== undefined) {
      if (debitAmountMinor > tier.singleTxnCap) {
        throw new TierLimitError(
          `Amount exceeds the single-transaction cap for KYC tier ${tier.tier}`,
        );
      }

      if (projectedBalanceMinor < 0n) {
        throw new TierLimitError('Insufficient balance');
      }
    }

    // balanceCap === 0 is the seeded convention for "no ceiling" (top tier).
    if (tier.balanceCap > 0n && projectedBalanceMinor > tier.balanceCap) {
      throw new TierLimitError(`Resulting balance exceeds the cap for KYC tier ${tier.tier}`);
    }

    if (debitAmountMinor !== undefined) {
      await this.checkDaily({ accountId, debitAmountMinor, dailyCap: tier.dailyCap, tier: tier.tier }, tx);
    }
  }

  /**
   * Sums today's outbound movements on `accountId` — "today" being the
   * user's civil day in LEDGER_TIMEZONE, not the database session's or
   * server's timezone — and rejects if adding `debitAmountMinor` would
   * cross the tier's daily cap.
   *
   * Runs mid-transaction, before the current leg's own posting is inserted
   * (see LedgerService.postEntry), so this only ever sums postings already
   * committed or already inserted earlier in *this* transaction — never the
   * in-flight leg it's gating, which is exactly why passing
   * `debitAmountMinor` as a separate addend (rather than trying to read it
   * back from the database) is correct.
   */
  private async checkDaily(
    input: { accountId: string; debitAmountMinor: bigint; dailyCap: bigint; tier: number },
    tx: PrismaTransactionClient,
  ): Promise<void> {
    const { accountId, debitAmountMinor, dailyCap, tier } = input;

    const rows = await tx.$queryRaw<DailyDebitRow[]>(
      Prisma.sql`
        -- SUM() over a bigint column yields NUMERIC, which the driver
        -- returns as a string; cast back to bigint so it deserializes the
        -- same way a plain bigint column read does (see BalanceService).
        SELECT SUM(-p.amount_minor)::bigint AS total
        FROM postings p
        JOIN journal_entries je ON je.id = p.entry_id
        WHERE p.account_id = ${accountId}
          AND p.amount_minor < 0
          AND (je.created_at AT TIME ZONE 'UTC')
              >= (date_trunc('day', now() AT TIME ZONE ${LEDGER_TIMEZONE}) AT TIME ZONE ${LEDGER_TIMEZONE})
      `,
    );
    const debitedToday = rows[0]?.total ?? 0n;

    if (debitedToday + debitAmountMinor > dailyCap) {
      throw new TierLimitError(`Amount exceeds the daily cap for KYC tier ${tier}`);
    }
  }
}
