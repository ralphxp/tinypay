import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '../../src/config/config.module.js';
import { PrismaModule } from '../../src/infra/database/prisma.module.js';
import { WalletModule } from '../../src/modules/wallet/wallet.module.js';
import { LedgerService } from '../../src/modules/wallet/ledger.service.js';
import { funding } from '../../src/modules/wallet/ledger.postings.js';
import { LedgerEntryNotFoundError } from '../../src/common/errors/domain-errors.js';
import { LedgerTestFactory, SETTLEMENT_ACCT } from './ledger-test.factory.js';

describe('Ledger: reversal', () => {
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

  it('posts the exact inverse and restores the pre-entry balance', async () => {
    const userId = await factory.createUser();
    const wallet = factory.walletRef(userId);
    await factory.seedBalance(wallet, 1000n);
    const originalRef = randomUUID();

    const original = await ledger.postEntry({
      externalRef: originalRef,
      kind: 'fund',
      legs: funding(wallet, SETTLEMENT_ACCT, 500n),
    });
    expect(await factory.getBalance(wallet)).toBe(1500n);

    const reversal = await ledger.reverse(originalRef);

    expect(reversal.entry.externalRef).toBe(`reverse:${originalRef}`);
    expect(reversal.entry.kind).toBe('reversal');
    expect(reversal.postings).toHaveLength(original.postings.length);

    const originalByAccount = new Map(original.postings.map((p) => [p.accountId, p.amountMinor]));
    for (const posting of reversal.postings) {
      expect(posting.amountMinor).toBe(-(originalByAccount.get(posting.accountId) ?? 0n));
    }

    expect(await factory.getBalance(wallet)).toBe(1000n);

    const originalEntry = await factory.prisma.journalEntry.findUniqueOrThrow({
      where: { externalRef: originalRef },
    });
    expect(originalEntry.status).toBe('reversed');
  });

  it('is idempotent — reversing the same ref twice posts the reversal once', async () => {
    const userId = await factory.createUser();
    const wallet = factory.walletRef(userId);
    await factory.seedBalance(wallet, 0n);
    const originalRef = randomUUID();

    await ledger.postEntry({
      externalRef: originalRef,
      kind: 'fund',
      legs: funding(wallet, SETTLEMENT_ACCT, 300n),
    });

    const first = await ledger.reverse(originalRef);
    const second = await ledger.reverse(originalRef);

    expect(second.entry.id).toBe(first.entry.id);
    expect(second.replayed).toBe(true);
    expect(await factory.getBalance(wallet)).toBe(0n);
  });

  it('errors cleanly when reversing a ref that was never posted', async () => {
    await expect(ledger.reverse(`does-not-exist-${randomUUID()}`)).rejects.toThrow(
      LedgerEntryNotFoundError,
    );
  });
});
