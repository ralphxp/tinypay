/** Core money verbs the resolver understands. Grammar is the floor for all
 * of these — an LLM outage can never block them (guiding principle #9). */
export type MoneyVerb = 'fund' | 'transfer' | 'withdraw' | 'contribute' | 'disburse' | 'balance';

export type TransferTarget =
  | { type: 'user'; userId: string }
  | { type: 'external_bank'; accountNumber: string; bankCode: string };

export type AuthRequirement = 'none' | 'pin' | 'webauthn' | 'admin_quorum';
