import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import type { AccountRef, CurrencyCode } from '../../src/shared/types/account.js';

/** Well-known system accounts, seeded by prisma/seed.ts — see SYSTEM_ACCOUNTS there. */
export const SETTLEMENT_ACCT: AccountRef = {
  ownerType: 'system',
  ownerId: 'psp_settlement_ngn',
  kind: 'psp_settlement',
};
export const FEES_ACCT: AccountRef = { ownerType: 'system', ownerId: 'fees_ngn', kind: 'fees' };

/**
 * Test-only setup helper for the ledger specs: creates users/groups and
 * seeds account balances directly, bypassing postEntry. Real code must never
 * mutate a balance outside a ledger transaction — this exists purely so
 * specs can arrange state without re-deriving it through the money path
 * they're not testing.
 */
export class LedgerTestFactory {
  readonly prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
  }

  async createUser(kycTier = 1): Promise<string> {
    const user = await this.prisma.user.create({
      data: { phone: `+234${randomUUID().replace(/-/g, '').slice(0, 10)}`, kycTier },
    });
    return user.id;
  }

  async createGroup(createdBy: string): Promise<string> {
    const group = await this.prisma.group.create({
      data: {
        chatRef: randomUUID(),
        channel: 'telegram',
        name: 'Ledger test group',
        createdBy,
        disbursePolicy: {},
      },
    });
    return group.id;
  }

  walletRef(userId: string): AccountRef {
    return { ownerType: 'user', ownerId: userId, kind: 'wallet' };
  }

  poolRef(groupId: string): AccountRef {
    return { ownerType: 'group', ownerId: groupId, kind: 'pool' };
  }

  private async ensureAccount(ref: AccountRef, currency: CurrencyCode = 'NGN') {
    const existing = await this.prisma.account.findFirst({
      where: { ownerType: ref.ownerType, ownerId: ref.ownerId, kind: ref.kind },
    });
    if (existing) return existing;

    return this.prisma.account.create({
      data: {
        ownerType: ref.ownerType,
        ownerId: ref.ownerId,
        kind: ref.kind,
        currency,
        balance: { create: { amountMinor: 0n } },
      },
    });
  }

  /** Ensures the ref's account exists and its balance is exactly `amountMinor`. */
  async seedBalance(ref: AccountRef, amountMinor: bigint): Promise<void> {
    const account = await this.ensureAccount(ref);
    await this.prisma.balance.update({ where: { accountId: account.id }, data: { amountMinor } });
  }

  async getBalance(ref: AccountRef): Promise<bigint> {
    const account = await this.prisma.account.findFirst({
      where: { ownerType: ref.ownerType, ownerId: ref.ownerId, kind: ref.kind },
    });
    if (!account) return 0n;
    const balance = await this.prisma.balance.findUnique({ where: { accountId: account.id } });
    return balance?.amountMinor ?? 0n;
  }

  async close(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
