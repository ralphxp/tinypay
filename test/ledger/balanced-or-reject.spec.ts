import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '../../src/config/config.module.js';
import { PrismaModule } from '../../src/infra/database/prisma.module.js';
import { WalletModule } from '../../src/modules/wallet/wallet.module.js';
import { LedgerService } from '../../src/modules/wallet/ledger.service.js';
import { funding } from '../../src/modules/wallet/ledger.postings.js';
import { LedgerImbalanceError } from '../../src/common/errors/domain-errors.js';
import { LedgerTestFactory, SETTLEMENT_ACCT } from './ledger-test.factory.js';

describe('Ledger: balanced-or-reject', () => {
  let moduleRef: TestingModule;
  let ledger: LedgerService;
  const factory = new LedgerTestFactory();

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, PrismaModule, WalletModule],
    }).compile();
    ledger = moduleRef.get(LedgerService);
    await moduleRef.init();
  });

  afterAll(async () => {
    await moduleRef.close();
    await factory.close();
  });

  it('posts a balanced entry', async () => {
    const userId = await factory.createUser();
    const wallet = factory.walletRef(userId);

    const { entry, postings } = await ledger.postEntry({
      externalRef: randomUUID(),
      kind: 'fund',
      legs: funding(wallet, SETTLEMENT_ACCT, 1000n),
    });

    expect(entry.status).toBe('posted');
    expect(postings).toHaveLength(2);
    expect(await factory.getBalance(wallet)).toBe(1000n);
  });

  it('rejects (app-level) an unbalanced legs array before touching the DB', async () => {
    const userId = await factory.createUser();
    const wallet = factory.walletRef(userId);

    await expect(
      ledger.postEntry({
        externalRef: randomUUID(),
        kind: 'fund',
        legs: [
          { accountRef: SETTLEMENT_ACCT, amountMinor: -1000n },
          { accountRef: wallet, amountMinor: 900n },
        ],
      }),
    ).rejects.toThrow(LedgerImbalanceError);
  });

  it('rejects (DB trigger) a hand-crafted unbalanced insert that bypasses LedgerService', async () => {
    const userId = await factory.createUser();
    const wallet = factory.walletRef(userId);
    await factory.seedBalance(wallet, 0n);
    const account = await factory.prisma.account.findFirstOrThrow({
      where: { ownerType: 'user', ownerId: userId, kind: 'wallet' },
    });

    const entryId = randomUUID();
    await expect(
      factory.prisma.$transaction(async (tx) => {
        await tx.journalEntry.create({
          data: { id: entryId, externalRef: `raw-unbalanced-${entryId}`, kind: 'fee', status: 'posted' },
        });
        await tx.posting.create({
          data: { entryId, accountId: account.id, amountMinor: 500n, currency: 'NGN' },
        });
        // Deliberately no offsetting leg — the deferred constraint trigger
        // must reject this at COMMIT, independent of any app-level check.
      }),
    ).rejects.toThrow(/unbalanced/i);
  });
});
