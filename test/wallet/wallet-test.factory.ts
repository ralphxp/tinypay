import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/** Test-only setup helper for wallet specs: creates users and seeds balances
 * directly, bypassing WalletService. Real code must never mutate a balance
 * outside WalletService's own transactions — this exists purely so specs can
 * arrange state without re-deriving it through the money path under test. */
export class WalletTestFactory {
  readonly prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
  }

  async createUser(): Promise<string> {
    const user = await this.prisma.user.create({
      data: { phone: `+234${randomUUID().replace(/-/g, '').slice(0, 10)}` },
    });
    return user.id;
  }

  async seedWalletBalance(userId: string, amountMinor: bigint): Promise<void> {
    await this.prisma.wallet.upsert({
      where: { userId },
      create: { userId, balanceMinor: amountMinor },
      update: { balanceMinor: amountMinor },
    });
  }

  async getBalance(userId: string): Promise<bigint> {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    return wallet?.balanceMinor ?? 0n;
  }

  async close(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
