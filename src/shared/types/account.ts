/** Mirrors the `accounts` table enums (prisma/schema.prisma) — the canonical
 * names live here; the Prisma schema is generated to match. */
export type OwnerType = 'user' | 'group' | 'system';

export type AccountKind = 'wallet' | 'pool' | 'psp_settlement' | 'fees' | 'revenue' | 'suspense';

export type CurrencyCode = 'NGN' | 'USD';

export type GroupRole = 'admin' | 'treasurer' | 'member';

/** Identifies an account by its owner, not by a resolved database id — the
 * resolver deals in these; account.service.ts turns them into real rows. */
export interface AccountRef {
  ownerType: OwnerType;
  ownerId: string;
  kind: AccountKind;
}
