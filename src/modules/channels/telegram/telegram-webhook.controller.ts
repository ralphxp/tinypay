import { Body, Controller, Headers, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import type { Update } from 'grammy/types';
import { Prisma } from '@prisma/client';
import { ConfigService } from '../../../config/config.service.js';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { TelegramAdapter } from './telegram.adapter.js';

@Controller('webhooks/telegram')
export class TelegramWebhookController {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramAdapter,
  ) {}

  @Post()
  @HttpCode(200)
  async handle(
    @Headers('x-telegram-bot-api-secret-token') secretToken: string | undefined,
    @Body() update: Update,
  ): Promise<{ ok: true }> {
    if (secretToken !== this.config.get('TELEGRAM_WEBHOOK_SECRET')) {
      throw new UnauthorizedException('Invalid webhook secret');
    }

    // Telegram retries a webhook delivery that doesn't get a timely 200 (a
    // cold start on Render's free tier is slow enough to trigger this
    // routinely) — without this, the same update_id is processed twice,
    // and the second pass reads as free-text input to whatever step the
    // first pass just advanced to, corrupting the flow. Same
    // insert-first/P2002-means-duplicate pattern as PaystackWebhookController.
    const eventId = `telegram:${update.update_id}`;
    try {
      await this.prisma.processedWebhookEvent.create({ data: { eventId, provider: 'telegram' } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return { ok: true };
      }
      throw err;
    }

    await this.telegram.handleUpdate(update);
    return { ok: true };
  }
}
