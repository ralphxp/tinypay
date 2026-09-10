import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '../../src/config/config.module.js';
import { PrismaModule } from '../../src/infra/database/prisma.module.js';
import { WalletModule } from '../../src/modules/wallet/wallet.module.js';
import { LedgerService } from '../../src/modules/wallet/ledger.service.js';
import { funding, withdrawal } from '../../src/modules/wallet/ledger.postings.js';
import { LedgerTestFactory, SETTLEMENT_ACCT } from './ledger-test.factory.js';

// Tier 1 caps, from prisma/seed.ts KYC_TIERS: singleTxnCap 5_000_000n,
// dailyCap 20_000_000n, balanceCap 30_000_000n.
const SINGLE_TXN_CAP = 5_000_000n;
const DAILY_CAP = 20_000_000n;
const BALANCE_CAP = 30_000_000n;

describe('Ledger: tier caps', () => {
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

  it('rejects a debit above the single-transaction cap', async () => {
    const userId = await factory.createUser(1);
    const wallet = factory.walletRef(userId);
    await factory.seedBalance(wallet, SINGLE_TXN_CAP * 2n);

    await expect(
      ledger.postEntry({
        externalRef: randomUUID(),
        kind: 'withdraw',
        legs: withdrawal(wallet, SETTLEMENT_ACCT, SINGLE_TXN_CAP + 1n),
      }),
    ).rejects.toThrow(/single-transaction cap/);

    expect(await factory.getBalance(wallet)).toBe(SINGLE_TXN_CAP * 2n);
  });

  it('rejects a debit that would overdraw the wallet', async () => {
    const userId = await factory.createUser(1);
    const wallet = factory.walletRef(userId);
    await factory.seedBalance(wallet, 1000n);

    await expect(
      ledger.postEntry({
        externalRef: randomUUID(),
        kind: 'withdraw',
        legs: withdrawal(wallet, SETTLEMENT_ACCT, 2000n),
      }),
    ).rejects.toThrow(/insufficient balance/i);

    expect(await factory.getBalance(wallet)).toBe(1000n);
  });

  it('rejects a credit that would breach the balance cap', async () => {
    const userId = await factory.createUser(1);
    const wallet = factory.walletRef(userId);
    await factory.seedBalance(wallet, BALANCE_CAP - 100n);

    await expect(
      ledger.postEntry({
        externalRef: randomUUID(),
        kind: 'fund',
        legs: funding(wallet, SETTLEMENT_ACCT, 200n),
      }),
    ).rejects.toThrow(/exceeds the cap/);

    expect(await factory.getBalance(wallet)).toBe(BALANCE_CAP - 100n);
  });

  it('allows a credit that stays within the balance cap', async () => {
    const userId = await factory.createUser(1);
    const wallet = factory.walletRef(userId);
    await factory.seedBalance(wallet, BALANCE_CAP - 100n);

    await ledger.postEntry({
      externalRef: randomUUID(),
      kind: 'fund',
      legs: funding(wallet, SETTLEMENT_ACCT, 100n),
    });

    expect(await factory.getBalance(wallet)).toBe(BALANCE_CAP);
  });

  it('passes a debit that stays under the daily cap, then rejects the one that crosses it', async () => {
    const userId = await factory.createUser(1);
    const wallet = factory.walletRef(userId);
    await factory.seedBalance(wallet, 25_000_000n);

    // Three debits at exactly the single-txn cap: cumulative daily = 15_000_000n.
    for (let i = 0; i < 3; i++) {
      await ledger.postEntry({
        externalRef: randomUUID(),
        kind: 'withdraw',
        legs: withdrawal(wallet, SETTLEMENT_ACCT, SINGLE_TXN_CAP),
      });
    }
    expect(await factory.getBalance(wallet)).toBe(25_000_000n - SINGLE_TXN_CAP * 3n);

    // Stays just under the remaining daily headroom (cumulative -> 19_999_999n): passes.
    await ledger.postEntry({
      externalRef: randomUUID(),
      kind: 'withdraw',
      legs: withdrawal(wallet, SETTLEMENT_ACCT, 4_999_999n),
    });
    expect(await factory.getBalance(wallet)).toBe(25_000_000n - SINGLE_TXN_CAP * 3n - 4_999_999n);

    // Crosses the daily cap (cumulative would be 20_000_001n): rejected, balance unchanged.
    const balanceBeforeReject = await factory.getBalance(wallet);
    await expect(
      ledger.postEntry({
        externalRef: randomUUID(),
        kind: 'withdraw',
        legs: withdrawal(wallet, SETTLEMENT_ACCT, 2n),
      }),
    ).rejects.toThrow(/daily cap/);
    expect(await factory.getBalance(wallet)).toBe(balanceBeforeReject);
  });

  it('allows a debit landing exactly at the daily cap boundary', async () => {
    const userId = await factory.createUser(1);
    const wallet = factory.walletRef(userId);
    await factory.seedBalance(wallet, 25_000_000n);

    for (let i = 0; i < 4; i++) {
      await ledger.postEntry({
        externalRef: randomUUID(),
        kind: 'withdraw',
        legs: withdrawal(wallet, SETTLEMENT_ACCT, SINGLE_TXN_CAP),
      });
    }

    // Cumulative daily debits == DAILY_CAP exactly (4 * 5_000_000n): must pass, not reject.
    expect(await factory.getBalance(wallet)).toBe(25_000_000n - DAILY_CAP);
  });
});
