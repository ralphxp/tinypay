import type { AccountRef } from './account.js';
import type { MoneyVerb } from './intent.js';

export interface MoneyActionLeg {
  accountRef: AccountRef;
  /** Stringified bigint — auth-link payloads are JSON. */
  amountMinor: string;
}

export interface PayoutDetails {
  accountNumber: string;
  bankCode: string;
  accountName: string;
}

/** The `data` payload of a `confirm_money_action` auth link — the exact,
 * already-resolved money movement, so nothing is re-derived at execution
 * time between confirm and PIN entry. */
export interface ConfirmMoneyActionData {
  verb: Exclude<MoneyVerb, 'balance' | 'fund'>;
  externalRef: string;
  legs: [MoneyActionLeg, MoneyActionLeg];
  amountMinor: string;
  /** Present when this action needs an outbound PSP transfer after posting. */
  payout?: PayoutDetails;
}
