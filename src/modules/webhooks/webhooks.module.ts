import { Module } from '@nestjs/common';
import { QueueModule } from '../../infra/queue/queue.module.js';
import { PaystackWebhookController } from './paystack.controller.js';

@Module({
  imports: [QueueModule],
  controllers: [PaystackWebhookController],
})
export class WebhooksModule {}
