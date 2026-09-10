import { Module } from '@nestjs/common';
import { TelegramService } from './telegram/telegram.service.js';
import { TelegramWebhookController } from './telegram/telegram.controller.js';
import { IdentityModule } from '../identity/identity.module.js';
import { ConversationModule } from '../conversation/conversation.module.js';

@Module({
  imports: [IdentityModule, ConversationModule],
  controllers: [TelegramWebhookController],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class ChannelsModule {}
