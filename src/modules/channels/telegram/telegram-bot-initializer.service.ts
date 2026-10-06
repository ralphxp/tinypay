import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Bot } from 'grammy';
import { TELEGRAM_BOT } from './telegram-bot.provider.js';

/**
 * Calls `bot.init()` once at boot — populates `bot.botInfo` (needed by
 * TelegramAdapter's @mention detection and by HealthController's readiness
 * check) and fails fast, with a clear log, if TELEGRAM_BOT_TOKEN is
 * configured but invalid. Lives in TelegramCoreModule (not TelegramAdapter)
 * so this happens exactly once regardless of which module pulls the bot in
 * (ChannelsModule, NotificationsModule, or just HealthModule).
 */
@Injectable()
export class TelegramBotInitializer implements OnModuleInit {
  private readonly logger = new Logger(TelegramBotInitializer.name);

  constructor(@Inject(TELEGRAM_BOT) private readonly bot: Bot | undefined) {}

  async onModuleInit(): Promise<void> {
    if (!this.bot) return;
    try {
      await this.bot.init();
    } catch (err) {
      this.logger.error('Failed to initialize the Telegram bot (invalid token?)', err instanceof Error ? err.stack : err);
    }
  }
}
