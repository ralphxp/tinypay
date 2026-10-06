import { Module } from '@nestjs/common';
import { PaystackClient } from './paystack/paystack.client.js';
import { PaystackProvider } from './paystack/paystack.provider.js';
import { BigisubClient } from './bigisub/bigisub.client.js';
import { BigisubProvider } from './bigisub/bigisub.provider.js';
import { BILLER_PORT } from './biller.port.js';

@Module({
  providers: [
    PaystackClient,
    PaystackProvider,
    BigisubClient,
    { provide: BILLER_PORT, useClass: BigisubProvider },
  ],
  exports: [PaystackProvider, BILLER_PORT],
})
export class PaymentsModule {}
