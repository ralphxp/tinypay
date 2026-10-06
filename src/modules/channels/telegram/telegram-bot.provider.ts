import { Bot } from 'grammy';
import type { Provider } from '@nestjs/common';
import { ConfigService } from '../../../config/config.service.js';

export const TELEGRAM_BOT = Symbol('TELEGRAM_BOT');

/**
 * The single shared grammy Bot instance — undefined when TELEGRAM_BOT_TOKEN
 * isn't configured (local dev/tests that never touch Telegram), so every
 * consumer (TelegramSenderService, TelegramAdapter, HealthController) must
 * treat it as optional and no-op rather than crash.
 */
export const telegramBotProvider: Provider = {
  provide: TELEGRAM_BOT,
  useFactory: (config: ConfigService): Bot | undefined => {
    const token = config.get('TELEGRAM_BOT_TOKEN');
    return token ? new Bot(token) : undefined;
  },
  inject: [ConfigService],
};
