import { TelegramNotificationDispatcher } from '../../src/modules/notifications/telegram-notification.dispatcher.js';
import type { TelegramSenderService } from '../../src/modules/channels/telegram/telegram-sender.service.js';
import type { ErrorLogService } from '../../src/infra/error-log/error-log.service.js';

describe('TelegramNotificationDispatcher: customer-facing receipts never leak provider detail', () => {
  function build() {
    const sender = { sendToUser: vi.fn().mockResolvedValue(undefined) } as unknown as TelegramSenderService;
    const errorLog = { log: vi.fn() } as unknown as ErrorLogService;
    return { dispatcher: new TelegramNotificationDispatcher(sender, errorLog), sender, errorLog };
  }

  it('wallet_funded with a fee renders a receipt breaking out amount, fee, and total', () => {
    const { dispatcher, sender } = build();
    dispatcher.emit({ kind: 'wallet_funded', userId: 'u1', amountMinor: 1000_00n, feeMinor: 15_00n, ref: 'tinypay-abc' });

    const [, message] = (sender.sendToUser as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(message.text).toContain('Ref: tinypay-abc');
    expect(message.text).toContain('Amount: ₦1,000.00');
    expect(message.text).toContain('Fee: ₦15.00');
    expect(message.text).toContain('Total paid: ₦1,015.00');
  });

  it('wallet_funded with no fee (feeMinor: 0) omits the fee/total lines entirely', () => {
    const { dispatcher, sender } = build();
    dispatcher.emit({ kind: 'wallet_funded', userId: 'u1', amountMinor: 500_00n, feeMinor: 0n, ref: 'tinypay-xyz' });

    const [, message] = (sender.sendToUser as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(message.text).not.toContain('Fee:');
    expect(message.text).not.toContain('Total paid:');
  });

  it('purchase_failed never includes the provider reason in the customer-facing text, only in the error log', () => {
    const { dispatcher, sender, errorLog } = build();
    dispatcher.emit({
      kind: 'purchase_failed',
      userId: 'u1',
      type: 'airtime',
      amountMinor: 500_00n,
      reason: 'Insufficient balance. You need ₦495.00 but have ₦100.00.',
      ref: 'tinypay-fail',
    });

    const [, message] = (sender.sendToUser as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(message.text).not.toContain('Insufficient balance');
    expect(message.text).not.toContain('₦495.00');
    expect((errorLog.log as ReturnType<typeof vi.fn>).mock.calls[0]![0].message).toContain('Insufficient balance');
  });

  it('purchase_completed renders a receipt with network and recipient', () => {
    const { dispatcher, sender } = build();
    dispatcher.emit({
      kind: 'purchase_completed',
      userId: 'u1',
      type: 'data',
      network: 'mtn',
      recipientPhone: '+2348011112222',
      amountMinor: 300_00n,
      ref: 'tinypay-data-1',
    });

    const [, message] = (sender.sendToUser as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(message.text).toContain('Type: Data');
    expect(message.text).toContain('Network: MTN');
    expect(message.text).toContain('Recipient: +2348011112222');
    expect(message.text).toContain('Status: Completed');
  });
});
