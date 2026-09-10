import type { AccountRef } from '../../shared/types/account.js';
import type { LedgerLeg } from './ledger.service.js';

/** A balanced set of legs for one movement kind — callers never hand-assemble signs. */
export type PostingInput = LedgerLeg;

export interface ContributionTags {
  groupId: string;
  memberId: string;
  roundId?: string;
}

export interface DisbursementTags {
  groupId: string;
}

/** Money into the wallet from the PSP settlement account (e.g. a DVA credit). */
export function funding(
  walletAcct: AccountRef,
  settlementAcct: AccountRef,
  amountMinor: bigint,
): PostingInput[] {
  return [
    { accountRef: walletAcct, amountMinor },
    { accountRef: settlementAcct, amountMinor: -amountMinor },
  ];
}

/**
 * Money out of the wallet to the PSP settlement account. `amountMinor` is
 * the full amount debited from the wallet; when a fee applies it is carved
 * out of that same amount into `feesAcct`, so settlement only receives the
 * net payout — the wallet is never debited more than the user authorized.
 */
export function withdrawal(
  walletAcct: AccountRef,
  settlementAcct: AccountRef,
  amountMinor: bigint,
  feeMinor: bigint = 0n,
  feesAcct?: AccountRef,
): PostingInput[] {
  if (feeMinor > 0n && !feesAcct) {
    throw new Error('feesAcct is required when feeMinor > 0');
  }

  const legs: PostingInput[] = [{ accountRef: walletAcct, amountMinor: -amountMinor }];

  if (feeMinor > 0n && feesAcct) {
    legs.push({ accountRef: settlementAcct, amountMinor: amountMinor - feeMinor });
    legs.push({ accountRef: feesAcct, amountMinor: feeMinor });
  } else {
    legs.push({ accountRef: settlementAcct, amountMinor });
  }

  return legs;
}

/** A member's contribution into a group's pool — both legs tagged for pot/share derivation. */
export function contribution(
  memberWalletAcct: AccountRef,
  poolAcct: AccountRef,
  amountMinor: bigint,
  tags: ContributionTags,
): PostingInput[] {
  return [
    { accountRef: memberWalletAcct, amountMinor: -amountMinor, ...tags },
    { accountRef: poolAcct, amountMinor, ...tags },
  ];
}

/**
 * Payout from a group's pool to the PSP settlement account. The pool leg is
 * groupId-tagged so it's included in that group's pot-total SUM; the
 * settlement leg is an external clearing leg, not member-attributable.
 */
export function disbursement(
  poolAcct: AccountRef,
  settlementAcct: AccountRef,
  amountMinor: bigint,
  tags: DisbursementTags,
): PostingInput[] {
  return [
    { accountRef: poolAcct, amountMinor: -amountMinor, ...tags },
    { accountRef: settlementAcct, amountMinor },
  ];
}
