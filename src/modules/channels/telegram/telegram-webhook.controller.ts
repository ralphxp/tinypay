import { Body, Controller, Headers, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import type { Update } from 'grammy/types';
import { ConfigService } from '../../../config/config.service.js';
import { TelegramAdapter } from './telegram.adapter.js';

@Controller('webhooks/telegram')
export class TelegramWebhookController {
  constructor(
    private readonly config: ConfigService,
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
    await this.telegram.handleUpdate(update);
    return { ok: true };
  }
}
