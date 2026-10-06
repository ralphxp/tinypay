import { Module } from '@nestjs/common';
import { TelegramCoreModule } from './telegram/telegram-core.module.js';
import { TelegramAdapter } from './telegram/telegram.adapter.js';
import { TelegramWebhookController } from './telegram/telegram-webhook.controller.js';
import { IdentityModule } from '../identity/identity.module.js';
import { ConversationModule } from '../conversation/conversation.module.js';

@Module({
  // TelegramCoreModule supplies the shared Bot instance + TelegramSenderService
  // (also consumed directly by NotificationsModule — see telegram-core.module.ts);
  // ConversationModule is what makes this the *real* pipeline (EnrollmentGuard ->
  // InvocationGate -> NLU -> resolver -> FSM), not just a send capability.
  imports: [TelegramCoreModule, IdentityModule, ConversationModule],
  controllers: [TelegramWebhookController],
  providers: [TelegramAdapter],
  exports: [TelegramAdapter],
})
export class ChannelsModule {}
