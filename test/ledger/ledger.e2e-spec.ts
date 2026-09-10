import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { ConfigModule } from '../../src/config/config.module.js';
import { PrismaModule } from '../../src/infra/database/prisma.module.js';
import { PrismaService } from '../../src/infra/database/prisma.service.js';
import { WalletModule } from '../../src/modules/wallet/wallet.module.js';
import { LedgerService } from '../../src/modules/wallet/ledger.service.js';
import { BalanceService } from '../../src/modules/wallet/balance.service.js';
import { LedgerImbalanceError, TierLimitError } from '../../src/common/errors/domain-errors.js';
import type { AccountRef } from '../../src/shared/types/account.js';

const rawPrisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function createTestUser(kycTier = 1): Promise<string> {
  const user = await rawPrisma.user.create({
    data: { phone: `+234${randomUUID().replace(/-/g, '').slice(0, 10)}`, kycTier },
  });
  return user.id;
}

function walletRef(userId: string): AccountRef {
  return { ownerType: 'user', ownerId: userId, kind: 'wallet' };
}

const pspRef: AccountRef = { ownerType: 'system', ownerId: 'psp_settlement_ngn', kind: 'psp_settlement' };

describe('LedgerService (e2e)', () => {
  let moduleRef: TestingModule;
  let ledger: LedgerService;
  let balances: BalanceService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, PrismaModule, WalletModule],
    }).compile();

    ledger = moduleRef.get(LedgerService);
    balances = moduleRef.get(BalanceService);
    await moduleRef.get(PrismaService).$connect();
  });

  afterAll(async () => {
    await moduleRef.close();
    await rawPrisma.$disconnect();
  });

  it('rejects entries whose legs do not sum to zero', async () => {
    await expect(
      ledger.postEntry({
        externalRef: randomUUID(),
        kind: 'fund',
        legs: [
          { accountRef: pspRef, amountMinor: -1000n },
          { accountRef: walletRef(await createTestUser()), amountMinor: 900n },
        ],
      }),
    ).rejects.toThrow(LedgerImbalanceError);
  });

  it('posts a balanced entry and updates both balances', async () => {
    const userId = await createTestUser();
    const { entry, postings } = await ledger.postEntry({
      externalRef: randomUUID(),
      kind: 'fund',
      legs: [
        { accountRef: pspRef, amountMinor: -5000n },
        { accountRef: walletRef(userId), amountMinor: 5000n },
      ],
    });

    expect(postings).toHaveLength(2);
    expect(entry.status).toBe('posted');

    const account = await rawPrisma.account.findFirstOrThrow({
      where: { ownerType: 'user', ownerId: userId, kind: 'wallet' },
    });
    expect(await balances.getBalance(account.id)).toBe(5000n);
  });

  it('is idempotent on externalRef — replay does not double-post', async () => {
    const userId = await createTestUser();
    const externalRef = randomUUID();
    const legs = [
      { accountRef: pspRef, amountMinor: -2000n },
      { accountRef: walletRef(userId), amountMinor: 2000n },
    ];

    const first = await ledger.postEntry({ externalRef, kind: 'fund', legs });
    const second = await ledger.postEntry({ externalRef, kind: 'fund', legs });

    expect(second.entry.id).toBe(first.entry.id);

    const account = await rawPrisma.account.findFirstOrThrow({
      where: { ownerType: 'user', ownerId: userId, kind: 'wallet' },
    });
    expect(await balances.getBalance(account.id)).toBe(2000n);
  });

  it('rejects a debit above the single-transaction cap for the tier', async () => {
    const userId = await createTestUser(1); // tier 1 singleTxnCap = 50_000_00
    await ledger.postEntry({
      externalRef: randomUUID(),
      kind: 'fund',
      legs: [
        { accountRef: pspRef, amountMinor: -100_000_00n },
        { accountRef: walletRef(userId), amountMinor: 100_000_00n },
      ],
    });

    await expect(
      ledger.postEntry({
        externalRef: randomUUID(),
        kind: 'withdraw',
        legs: [
          { accountRef: walletRef(userId), amountMinor: -60_000_00n },
          { accountRef: pspRef, amountMinor: 60_000_00n },
        ],
      }),
    ).rejects.toThrow(TierLimitError);
  });

  it('never overdraws a wallet under concurrent debits (row locking holds)', async () => {
    const userId = await createTestUser();
    const account = await rawPrisma.account.create({
      data: {
        ownerType: 'user',
        ownerId: userId,
        kind: 'wallet',
        currency: 'NGN',
        balance: { create: { amountMinor: 1000n } },
      },
    });

    const attempt = () =>
      ledger
        .postEntry({
          externalRef: randomUUID(),
          kind: 'withdraw',
          legs: [
            { accountRef: walletRef(userId), amountMinor: -800n },
            { accountRef: pspRef, amountMinor: 800n },
          ],
        })
        .then(() => 'ok' as const)
        .catch((err: unknown) => {
          if (err instanceof TierLimitError) return 'insufficient' as const;
          throw err;
        });

    const results = await Promise.all([attempt(), attempt()]);

    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    expect(results.filter((r) => r === 'insufficient')).toHaveLength(1);
    expect(await balances.getBalance(account.id)).toBe(200n);
  });
});
