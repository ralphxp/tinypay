import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule } from './config/config.module.js';
import { PrismaModule } from './infra/database/prisma.module.js';
import { ErrorLogModule } from './infra/error-log/error-log.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { WalletModule } from './modules/wallet/wallet.module.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { WebhooksModule } from './modules/webhooks/webhooks.module.js';
import { NluModule } from './modules/nlu/nlu.module.js';
import { ConversationModule } from './modules/conversation/conversation.module.js';
import { ChannelsModule } from './modules/channels/channels.module.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    ErrorLogModule,
    HealthModule,
    WalletModule,
    IdentityModule,
    PaymentsModule,
    WebhooksModule,
    NluModule,
    ConversationModule,
    ChannelsModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
