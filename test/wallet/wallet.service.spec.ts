import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '../../src/config/config.module.js';
import { PrismaModule } from '../../src/infra/database/prisma.module.js';
import { WalletService } from '../../src/modules/wallet/wallet.service.js';
import { InsufficientBalanceError } from '../../src/common/errors/domain-errors.js';
import { WalletTestFactory } from './wallet-test.factory.js';

describe('WalletService: money lives in Paystack, this is bookkeeping', () => {
  let moduleRef: TestingModule;
  let wallet: WalletService;
  const factory = new WalletTestFactory();

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, PrismaModule],
      providers: [WalletService],
    }).compile();
    wallet = moduleRef.get(WalletService);
  });

  afterAll(async () => {
    await moduleRef.close();
    await factory.close();
  });

  it('a brand-new user has a zero balance', async () => {
    const userId = await factory.createUser();
    expect(await wallet.getBalance(userId)).toBe(0n);
  });

  describe('funding', () => {
    it('reserveFund then completeFund credits the balance exactly once', async () => {
      const userId = await factory.createUser();
      const ref = `tinypay:${randomUUID()}`;

      await wallet.reserveFund({ userId, ref, amountMinor: 500_00n });
      expect(await wallet.getBalance(userId)).toBe(0n); // reserving alone never moves the balance

      const credited = await wallet.completeFund(ref, 'psp_ref_1');
      expect(credited).toEqual({ userId, amountMinor: 500_00n, feeMinor: 0n });
      expect(await wallet.getBalance(userId)).toBe(500_00n);
    });

    it('completeFund is idempotent — a redelivered webhook never double-credits', async () => {
      const userId = await factory.createUser();
      const ref = `tinypay:${randomUUID()}`;
      await wallet.reserveFund({ userId, ref, amountMinor: 1000_00n });

      await wallet.completeFund(ref, 'psp_ref_1');
      const secondAttempt = await wallet.completeFund(ref, 'psp_ref_1');

      expect(secondAttempt).toBeNull(); // nothing to credit — already completed
      expect(await wallet.getBalance(userId)).toBe(1000_00n);
    });

    it('completeFund for a ref nobody reserved is a no-op, not a crash', async () => {
      const result = await wallet.completeFund(`tinypay:${randomUUID()}`, 'psp_ref_x');
      expect(result).toBeNull();
    });

    it('reserveFund is idempotent on ref — a retried call reuses the same transaction', async () => {
      const userId = await factory.createUser();
      const ref = `tinypay:${randomUUID()}`;

      const first = await wallet.reserveFund({ userId, ref, amountMinor: 200_00n });
      const second = await wallet.reserveFund({ userId, ref, amountMinor: 200_00n });

      expect(second.transactionId).toBe(first.transactionId);
    });
  });

  describe('purchases (airtime/data) — reserveDebit/markCompleted/refundFailed', () => {
    it('reserveDebit takes the balance immediately, before any biller call', async () => {
      const userId = await factory.createUser();
      await factory.seedWalletBalance(userId, 1000_00n);
      const ref = `tinypay:${randomUUID()}`;

      await wallet.reserveDebit({
        userId,
        ref,
        amountMinor: 300_00n,
        type: 'airtime',
        network: 'mtn',
        recipientPhone: '+2348031234567',
      });

      expect(await wallet.getBalance(userId)).toBe(700_00n);
    });

    it('reserveDebit throws InsufficientBalanceError and never touches the balance when it would go negative', async () => {
      const userId = await factory.createUser();
      await factory.seedWalletBalance(userId, 100_00n);
      const ref = `tinypay:${randomUUID()}`;

      await expect(
        wallet.reserveDebit({
          userId,
          ref,
          amountMinor: 500_00n,
          type: 'airtime',
          network: 'mtn',
          recipientPhone: '+2348031234567',
        }),
      ).rejects.toBeInstanceOf(InsufficientBalanceError);

      expect(await wallet.getBalance(userId)).toBe(100_00n); // the attempted decrement rolled back with the transaction
    });

    it('reserveDebit is idempotent on ref — a retried call never double-debits', async () => {
      const userId = await factory.createUser();
      await factory.seedWalletBalance(userId, 1000_00n);
      const ref = `tinypay:${randomUUID()}`;
      const input = {
        userId,
        ref,
        amountMinor: 300_00n,
        type: 'airtime' as const,
        network: 'mtn' as const,
        recipientPhone: '+2348031234567',
      };

      const first = await wallet.reserveDebit(input);
      const second = await wallet.reserveDebit(input);

      expect(second.alreadyReserved).toBe(true);
      expect(second.transactionId).toBe(first.transactionId);
      expect(await wallet.getBalance(userId)).toBe(700_00n); // debited once, not twice
    });

    it('refundFailed gives the money back exactly once, even if called twice', async () => {
      const userId = await factory.createUser();
      await factory.seedWalletBalance(userId, 1000_00n);
      const ref = `tinypay:${randomUUID()}`;

      const { transactionId } = await wallet.reserveDebit({
        userId,
        ref,
        amountMinor: 300_00n,
        type: 'data',
        network: 'glo',
        recipientPhone: '+2348031234567',
      });
      expect(await wallet.getBalance(userId)).toBe(700_00n);

      await wallet.refundFailed(transactionId, 'Biller declined the purchase');
      await wallet.refundFailed(transactionId, 'Biller declined the purchase'); // simulates a retried job

      expect(await wallet.getBalance(userId)).toBe(1000_00n); // refunded once, not twice
    });

    it('markCompleted is idempotent and never refunds an already-completed purchase', async () => {
      const userId = await factory.createUser();
      await factory.seedWalletBalance(userId, 1000_00n);
      const ref = `tinypay:${randomUUID()}`;

      const { transactionId } = await wallet.reserveDebit({
        userId,
        ref,
        amountMinor: 300_00n,
        type: 'airtime',
        network: 'airtel',
        recipientPhone: '+2348031234567',
      });

      await wallet.markCompleted(transactionId, 'order_123');
      await wallet.refundFailed(transactionId, 'late/duplicate failure signal'); // must be a no-op now

      expect(await wallet.getBalance(userId)).toBe(700_00n); // still debited, never refunded after completion
    });
  });

  describe('history', () => {
    it('lists transactions newest-first', async () => {
      const userId = await factory.createUser();
      await wallet.reserveFund({ userId, ref: `tinypay:${randomUUID()}`, amountMinor: 100_00n });
      await wallet.reserveFund({ userId, ref: `tinypay:${randomUUID()}`, amountMinor: 200_00n });

      const history = await wallet.listTransactions(userId, 10);
      expect(history.length).toBe(2);
      expect(history[0]!.createdAt.getTime()).toBeGreaterThanOrEqual(history[1]!.createdAt.getTime());
    });
  });
});
