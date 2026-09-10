import { Injectable, NotImplementedException } from '@nestjs/common';
import { PaystackProvider } from './paystack/paystack.provider.js';
import type { PspPort } from './psp.port.js';
import type { CurrencyCode } from '../../shared/types/account.js';

@Injectable()
export class PaymentsOrchestrator {
  constructor(private readonly paystack: PaystackProvider) {}

  forCurrency(currency: CurrencyCode): PspPort {
    if (currency === 'NGN') return this.paystack;
    // USD routes to Stripe — deferred to P4 (docs/SPEC.md section 10).
    throw new NotImplementedException(`No PSP configured for currency ${currency}`);
  }
}
