import { randomUUID, createHmac } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '../../src/config/config.module.js';
import { PrismaModule } from '../../src/infra/database/prisma.module.js';
import { PrismaService } from '../../src/infra/database/prisma.service.js';
import { ConfigService } from '../../src/config/config.service.js';
import { WalletService } from '../../src/modules/wallet/wallet.service.js';
import { NOTIFICATION_SINK, LoggingNotificationSink } from '../../src/modules/notifications/notification.port.js';
import { PaystackWebhookController } from '../../src/modules/webhooks/paystack.controller.js';
import { WalletTestFactory } from '../wallet/wallet-test.factory.js';

function sign(body: Buffer, secret: string): string {
  return createHmac('sha512', secret).update(body).digest('hex');
}

function req(rawBody: Buffer, body: unknown) {
  return { rawBody, body } as never;
}

describe('PaystackWebhookController: verify before trust, wallet credit inline, no queue', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let config: ConfigService;
  let wallet: WalletService;
  let sink: LoggingNotificationSink;
  let controller: PaystackWebhookController;
  const factory = new WalletTestFactory();
  const SECRET = 'sk_test_webhook_secret_for_tests';

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, PrismaModule],
      providers: [
        WalletService,
        PaystackWebhookController,
        { provide: NOTIFICATION_SINK, useClass: LoggingNotificationSink },
      ],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    config = moduleRef.get(ConfigService);
    wallet = moduleRef.get(WalletService);
    sink = moduleRef.get(NOTIFICATION_SINK);
    controller = moduleRef.get(PaystackWebhookController);
    vi.spyOn(config, 'get').mockImplementation(((key: string) =>
      key === 'PAYSTACK_SECRET_KEY' ? SECRET : undefined) as never);
  });

  afterAll(async () => {
    await moduleRef.close();
    await factory.close();
  });

  it('a valid HMAC-SHA512 over the raw bytes credits the wallet and emits wallet_funded', async () => {
    const userId = await factory.createUser();
    const ref = `tinypay:${randomUUID()}`;
    await wallet.reserveFund({ userId, ref, amountMinor: 500_00n });

    const payload = { event: 'charge.success', data: { id: randomUUID(), reference: ref, amount: 50000 } };
    const raw = Buffer.from(JSON.stringify(payload));
    const signature = sign(raw, SECRET);
    const before = sink.getEmitted().length;

    const result = await controller.handle(req(raw, payload), signature);

    expect(result).toEqual({ received: true });
    expect(await wallet.getBalance(userId)).toBe(500_00n);
    expect(sink.getEmitted().slice(before)).toEqual([
      { kind: 'wallet_funded', userId, amountMinor: 500_00n, feeMinor: 0n, ref },
    ]);
  });

  it('a tampered body (signature computed over the original) is rejected with 401, wallet untouched', async () => {
    const userId = await factory.createUser();
    const ref = `tinypay:${randomUUID()}`;
    await wallet.reserveFund({ userId, ref, amountMinor: 100_00n });

    const original = { event: 'charge.success', data: { id: randomUUID(), reference: ref, amount: 10000 } };
    const originalRaw = Buffer.from(JSON.stringify(original));
    const signature = sign(originalRaw, SECRET);

    const tampered = { ...original, data: { ...original.data, amount: 999_999_999 } };
    const tamperedRaw = Buffer.from(JSON.stringify(tampered));

    await expect(controller.handle(req(tamperedRaw, tampered), signature)).rejects.toMatchObject({ status: 401 });
    expect(await wallet.getBalance(userId)).toBe(0n);
  });

  it('a bad signature (wrong secret) is rejected with 401', async () => {
    const payload = { event: 'charge.success', data: { id: randomUUID(), reference: 'x', amount: 100 } };
    const raw = Buffer.from(JSON.stringify(payload));
    const badSignature = sign(raw, 'sk_test_wrong_secret');

    await expect(controller.handle(req(raw, payload), badSignature)).rejects.toMatchObject({ status: 401 });
  });

  it('a missing signature header is rejected with 401', async () => {
    const payload = { event: 'charge.success', data: { id: randomUUID() } };
    const raw = Buffer.from(JSON.stringify(payload));

    await expect(controller.handle(req(raw, payload), undefined)).rejects.toMatchObject({ status: 401 });
  });

  it('dedupes on the provider event id: a replayed delivery is a 200 no-op, no double credit', async () => {
    const userId = await factory.createUser();
    const ref = `tinypay:${randomUUID()}`;
    await wallet.reserveFund({ userId, ref, amountMinor: 250_00n });

    const payload = { event: 'charge.success', data: { id: randomUUID(), reference: ref, amount: 25000 } };
    const raw = Buffer.from(JSON.stringify(payload));
    const signature = sign(raw, SECRET);

    const first = await controller.handle(req(raw, payload), signature);
    const second = await controller.handle(req(raw, payload), signature);

    expect(first).toEqual({ received: true });
    expect(second).toEqual({ received: true });
    expect(await wallet.getBalance(userId)).toBe(250_00n); // credited once, not twice
  });

  it('a charge.success for a reference this app never reserved is acknowledged and does nothing', async () => {
    const payload = {
      event: 'charge.success',
      data: { id: randomUUID(), reference: `tinypay:${randomUUID()}`, amount: 1000 },
    };
    const raw = Buffer.from(JSON.stringify(payload));
    const signature = sign(raw, SECRET);

    await expect(controller.handle(req(raw, payload), signature)).resolves.toEqual({ received: true });
  });

  it('any other event type is acknowledged and dropped — no wallet effect', async () => {
    const payload = { event: 'subscription.create', data: { id: randomUUID() } };
    const raw = Buffer.from(JSON.stringify(payload));
    const signature = sign(raw, SECRET);

    await expect(controller.handle(req(raw, payload), signature)).resolves.toEqual({ received: true });
  });

  it('records a ProcessedWebhookEvent row per distinct event id', async () => {
    const eventId = randomUUID();
    const payload = { event: 'charge.success', data: { id: eventId, reference: `tinypay:${randomUUID()}`, amount: 1 } };
    const raw = Buffer.from(JSON.stringify(payload));
    const signature = sign(raw, SECRET);

    await controller.handle(req(raw, payload), signature);

    const row = await prisma.processedWebhookEvent.findUnique({ where: { eventId: `paystack:${eventId}` } });
    expect(row).not.toBeNull();
  });
});
