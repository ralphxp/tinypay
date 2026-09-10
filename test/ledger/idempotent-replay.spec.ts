import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '../../src/config/config.module.js';
import { PrismaModule } from '../../src/infra/database/prisma.module.js';
import { WalletModule } from '../../src/modules/wallet/wallet.module.js';
import { LedgerService } from '../../src/modules/wallet/ledger.service.js';
import { funding } from '../../src/modules/wallet/ledger.postings.js';
import { LedgerTestFactory, SETTLEMENT_ACCT } from './ledger-test.factory.js';

describe('Ledger: idempotent replay', () => {
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

  it('posts once and replays the same result on a repeated externalRef', async () => {
    const userId = await factory.createUser();
    const wallet = factory.walletRef(userId);
    const externalRef = randomUUID();
    const legs = funding(wallet, SETTLEMENT_ACCT, 750n);

    const first = await ledger.postEntry({ externalRef, kind: 'fund', legs });
    expect(first.replayed).toBeFalsy();

    const second = await ledger.postEntry({ externalRef, kind: 'fund', legs });
    expect(second.replayed).toBe(true);
    expect(second.entry.id).toBe(first.entry.id);
    expect(second.postings).toHaveLength(first.postings.length);

    // Balance reflects a single posting, not two.
    expect(await factory.getBalance(wallet)).toBe(750n);
  });

  it('stays idempotent under concurrent replay of the same ref (P2002 race path)', async () => {
    const userId = await factory.createUser();
    const wallet = factory.walletRef(userId);
    const externalRef = randomUUID();
    const legs = funding(wallet, SETTLEMENT_ACCT, 400n);

    const [a, b] = await Promise.all([
      ledger.postEntry({ externalRef, kind: 'fund', legs }),
      ledger.postEntry({ externalRef, kind: 'fund', legs }),
    ]);

    expect(a.entry.id).toBe(b.entry.id);
    expect(await factory.getBalance(wallet)).toBe(400n);
  });
});
