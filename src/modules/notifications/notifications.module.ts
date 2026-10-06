import { Module } from '@nestjs/common';
import { TelegramCoreModule } from '../channels/telegram/telegram-core.module.js';
import { NOTIFICATION_SINK } from './notification.port.js';
import { TelegramNotificationDispatcher } from './telegram-notification.dispatcher.js';

@Module({
  // TelegramCoreModule is the minimal, send-only Telegram capability (no
  // ConversationModule/QueueModule dependency) — importing it here, rather
  // than the full ChannelsModule, is what keeps QueueModule ->
  // NotificationsModule -> ChannelsModule -> ConversationModule ->
  // QueueModule from becoming a cycle (see telegram-core.module.ts).
  imports: [TelegramCoreModule],
  providers: [{ provide: NOTIFICATION_SINK, useClass: TelegramNotificationDispatcher }],
  exports: [NOTIFICATION_SINK],
})
export class NotificationsModule {}
