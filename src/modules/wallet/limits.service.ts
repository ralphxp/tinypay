import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TierLimitError } from '../../common/errors/domain-errors.js';
import type { PrismaTransactionClient } from '../../infra/database/prisma.service.js';

interface DailyDebitRow {
  total: bigint | null;
}

export interface LimitCheckInput {
  userId: string;
  accountId: string;
  /** Positive magnitude of the amount being debited from the wallet. */
  debitAmountMinor: bigint;
  /** The wallet's balance after this debit would apply. */
  projectedBalanceMinor: bigint;
}

@Injectable()
export class LimitsService {
  /** Enforces the actor's KYC tier caps at post time — never in copy (guiding principle #10). */
  async assertWithinLimits(input: LimitCheckInput, tx: PrismaTransactionClient): Promise<void> {
    const { userId, accountId, debitAmountMinor, projectedBalanceMinor } = input;

    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const tier = await tx.kycTier.findUniqueOrThrow({ where: { tier: user.kycTier } });

    if (debitAmountMinor > tier.singleTxnCap) {
      throw new TierLimitError(
        `Amount exceeds the single-transaction cap for KYC tier ${tier.tier}`,
      );
    }

    if (projectedBalanceMinor < 0n) {
      throw new TierLimitError('Insufficient balance');
    }

    // balanceCap === 0 is the seeded convention for "no ceiling" (top tier).
    if (tier.balanceCap > 0n && projectedBalanceMinor > tier.balanceCap) {
      throw new TierLimitError(`Resulting balance exceeds the cap for KYC tier ${tier.tier}`);
    }

    const rows = await tx.$queryRaw<DailyDebitRow[]>(
      Prisma.sql`
        SELECT SUM(-p.amount_minor) AS total
        FROM postings p
        JOIN journal_entries je ON je.id = p.entry_id
        WHERE p.account_id = ${accountId}
          AND p.amount_minor < 0
          AND je.created_at >= date_trunc('day', now())
      `,
    );
    const debitedToday = rows[0]?.total ?? 0n;

    if (debitedToday + debitAmountMinor > tier.dailyCap) {
      throw new TierLimitError(`Amount exceeds the daily cap for KYC tier ${tier.tier}`);
    }
  }
}
