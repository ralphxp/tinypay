import { Module } from '@nestjs/common';
import { TelegramCoreModule } from '../channels/telegram/telegram-core.module.js';
import { ErrorLogModule } from '../../infra/error-log/error-log.module.js';
import { NOTIFICATION_SINK } from './notification.port.js';
import { TelegramNotificationDispatcher } from './telegram-notification.dispatcher.js';

@Module({
  // TelegramCoreModule is the minimal, send-only Telegram capability (no
  // ConversationModule/QueueModule dependency) — importing it here, rather
  // than the full ChannelsModule, is what keeps QueueModule ->
  // NotificationsModule -> ChannelsModule -> ConversationModule ->
  // QueueModule from becoming a cycle (see telegram-core.module.ts). Same
  // reasoning applies to ErrorLogModule being imported explicitly here even
  // though it's @Global() — a module's exports only propagate app-wide once
  // it's been imported *somewhere* in the compiled graph, and an isolated
  // test module (e.g. money-flows.spec.ts) may compile ConversationModule
  // without ever importing ErrorLogModule itself.
  imports: [TelegramCoreModule, ErrorLogModule],
  providers: [{ provide: NOTIFICATION_SINK, useClass: TelegramNotificationDispatcher }],
  exports: [NOTIFICATION_SINK],
})
export class NotificationsModule {}
