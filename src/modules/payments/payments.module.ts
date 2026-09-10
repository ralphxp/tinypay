import { Module } from '@nestjs/common';
import { PaystackClient } from './paystack/paystack.client.js';
import { PaystackProvider } from './paystack/paystack.provider.js';
import { PaymentsOrchestrator } from './payments.orchestrator.js';

@Module({
  providers: [PaystackClient, PaystackProvider, PaymentsOrchestrator],
  exports: [PaystackClient, PaystackProvider, PaymentsOrchestrator],
})
export class PaymentsModule {}
