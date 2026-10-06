import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PaystackWebhookController } from './paystack.controller.js';

@Module({
  imports: [WalletModule, NotificationsModule],
  controllers: [PaystackWebhookController],
})
export class WebhooksModule {}
