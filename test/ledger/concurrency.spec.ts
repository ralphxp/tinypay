import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '../../src/config/config.module.js';
import { PrismaModule } from '../../src/infra/database/prisma.module.js';
import { WalletModule } from '../../src/modules/wallet/wallet.module.js';
import { LedgerService } from '../../src/modules/wallet/ledger.service.js';
import { withdrawal } from '../../src/modules/wallet/ledger.postings.js';
import { TierLimitError } from '../../src/common/errors/domain-errors.js';
import { LedgerTestFactory, SETTLEMENT_ACCT, sleep } from './ledger-test.factory.js';

// The centerpiece spec for Slice 1: proves BalanceService.lockForUpdate's
// `SELECT ... FOR UPDATE` is load-bearing, not decorative. Two debits are
// each individually valid against the starting balance but not valid
// together — without the lock both would read the same stale balance and
// both would be allowed to proceed (an overdraw slipping through), even
// though the final `amount_minor` column value would still add up, because
// a plain `UPDATE ... SET x = x + delta` is atomic regardless of locking.
// The lock's job is to serialize the *decision*, not the arithmetic.
describe('Ledger: concurrency', () => {
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

  it('serializes two concurrent debits on the same wallet: exactly one succeeds, balance is exact', async () => {
    const userId = await factory.createUser();
    const wallet = factory.walletRef(userId);
    await factory.seedBalance(wallet, 1000n);

    const attempt = (delayMs: number) =>
      sleep(delayMs)
        .then(() =>
          ledger.postEntry({
            externalRef: randomUUID(),
            kind: 'withdraw',
            legs: withdrawal(wallet, SETTLEMENT_ACCT, 700n),
          }),
        )
        .then(() => 'ok' as const)
        .catch((err: unknown) => {
          if (err instanceof TierLimitError) return 'rejected' as const;
          throw err;
        });

    // Both calls are in flight concurrently (Promise.all, not sequential
    // awaits); B gets a tiny head-start delay only so its FOR UPDATE attempt
    // is guaranteed to land while A's transaction — which does several
    // round trips (lock, limit checks, insert, balance update) — is still
    // open, rather than depending on incidental scheduling.
    const results = await Promise.all([attempt(0), attempt(5)]);

    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    expect(results.filter((r) => r === 'rejected')).toHaveLength(1);

    // No lost update, no overdraw slipping through: exactly one 700n debit
    // landed, not zero, not two, and never negative.
    expect(await factory.getBalance(wallet)).toBe(300n);
  });
});
