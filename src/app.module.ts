import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module.js';
import { PrismaModule } from './infra/database/prisma.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { WalletModule } from './modules/wallet/wallet.module.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { WebhooksModule } from './modules/webhooks/webhooks.module.js';
import { NluModule } from './modules/nlu/nlu.module.js';
import { ConversationModule } from './modules/conversation/conversation.module.js';
import { ChannelsModule } from './modules/channels/channels.module.js';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    HealthModule,
    WalletModule,
    IdentityModule,
    PaymentsModule,
    WebhooksModule,
    NluModule,
    ConversationModule,
    ChannelsModule,
  ],
})
export class AppModule {}
