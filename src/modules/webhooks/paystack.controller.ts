import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { ConfigService } from '../../config/config.service.js';
import { PrismaService } from '../../infra/database/prisma.service.js';
import { SETTLEMENT_QUEUE } from '../../infra/queue/queue.constants.js';

@Controller('webhooks/paystack')
export class PaystackWebhookController {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    @InjectQueue(SETTLEMENT_QUEUE) private readonly settlementQueue: Queue,
  ) {}

  @Post()
  @HttpCode(200)
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-paystack-signature') signature: string | undefined,
  ): Promise<{ received: true }> {
    if (!req.rawBody || !signature) {
      throw new BadRequestException('Missing signature or body');
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
      throw new BadRequestException('Invalid signature');
    }

    const event = req.body as { event: string; data: Record<string, unknown> };
    const eventId = `paystack:${String(event.data.id ?? event.data.reference)}`;

    try {
      await this.prisma.processedWebhookEvent.create({
        data: { eventId, provider: 'paystack' },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // Already seen this event — ack without re-enqueueing.
        return { received: true };
      }
      throw err;
    }

    await this.settlementQueue.add('paystack-event', event, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 5_000 },
    });

    return { received: true };
  }
}
