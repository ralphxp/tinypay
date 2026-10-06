import { Module } from '@nestjs/common';
import { ConfigModule } from '../../../config/config.module.js';
import { IdentityModule } from '../../identity/identity.module.js';
import { telegramBotProvider, TELEGRAM_BOT } from './telegram-bot.provider.js';
import { TelegramSenderService } from './telegram-sender.service.js';
import { TelegramBotInitializer } from './telegram-bot-initializer.service.js';

/**
 * The minimal, send-only Telegram capability: the shared Bot instance and
 * TelegramSenderService. Deliberately depends on nothing but ConfigModule
 * and IdentityModule (both leaves) — NotificationsModule imports this
 * directly so a money processor's notification intent can reach Telegram,
 * without pulling QueueModule -> NotificationsModule -> ChannelsModule ->
 * ConversationModule -> QueueModule into a cycle. The full inbound/outbound
 * TelegramAdapter (ChannelsModule) also depends on this module rather than
 * constructing its own Bot instance, so there is exactly one bot per token.
 */
@Module({
  imports: [ConfigModule, IdentityModule],
  providers: [telegramBotProvider, TelegramSenderService, TelegramBotInitializer],
  exports: [TELEGRAM_BOT, TelegramSenderService],
})
export class TelegramCoreModule {}
