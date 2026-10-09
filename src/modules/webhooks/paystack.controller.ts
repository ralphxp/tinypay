import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
  Req,
  UnauthorizedException,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { ConfigService } from '../../config/config.service.js';
import { PrismaService } from '../../infra/database/prisma.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import { NOTIFICATION_SINK, type NotificationSink } from '../notifications/notification.port.js';

/**
 * Verify before trust, always: the signature is checked against the raw
 * bytes (main.ts bootstraps with rawBody:true) before anything in the body
 * is read, let alone acted on. No queue in this build — crediting a wallet
 * is one fast DB transaction, so it happens inline in the handler; the only
 * async work after that is a single outbound Telegram/WhatsApp send
 * (fire-and-forget via NotificationSink — see TelegramNotificationDispatcher).
 */
@Controller('webhooks/paystack')
export class PaystackWebhookController {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    @Inject(NOTIFICATION_SINK) private readonly notifications: NotificationSink,
  ) {}

  @Post()
  @HttpCode(200)
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-paystack-signature') signature: string | undefined,
  ): Promise<{ received: true }> {
    if (!req.rawBody || !signature) {
      throw new UnauthorizedException('Missing signature or body');
    }

    // Paystack signs with the API secret key itself, not a separate webhook
    // secret (unlike Stripe) — see https://paystack.com/docs/payments/webhooks.
    const expected = createHmac('sha512', this.config.get('PAYSTACK_SECRET_KEY') ?? '')
      .update(req.rawBody)
      .digest('hex');

    if (
      expected.length !== signature.length ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
    ) {
      throw new UnauthorizedException('Invalid signature');
    }

    const event = req.body as { event: string; data: Record<string, unknown> };
    const eventId = `paystack:${String(event.data.id ?? event.data.reference)}`;

    try {
      await this.prisma.processedWebhookEvent.create({
        data: { eventId, provider: 'paystack' },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // Already seen this event — ack without re-processing.
        return { received: true };
      }
      throw err;
    }

    if (event.event === 'charge.success') {
      const reference = String(event.data.reference);
      const providerRef = String(event.data.id);
      const credited = await this.wallet.completeFund(reference, providerRef);
      if (credited) {
        this.notifications.emit({
          kind: 'wallet_funded',
          userId: credited.userId,
          amountMinor: credited.amountMinor,
          feeMinor: credited.feeMinor,
          ref: reference,
        });
      }
    }
    // Any other event type is acknowledged (event-id already recorded above) and dropped.

    return { received: true };
  }
}
