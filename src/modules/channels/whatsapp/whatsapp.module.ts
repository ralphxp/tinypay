import { Module } from '@nestjs/common';
import { IdentityModule } from '../../identity/identity.module.js';
import { ConversationModule } from '../../conversation/conversation.module.js';
import { TwilioClient } from './twilio-client.js';
import { WhatsAppAdapter } from './whatsapp.adapter.js';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller.js';

@Module({
  imports: [IdentityModule, ConversationModule],
  controllers: [WhatsAppWebhookController],
  providers: [TwilioClient, WhatsAppAdapter],
  exports: [WhatsAppAdapter],
})
export class WhatsAppModule {}
