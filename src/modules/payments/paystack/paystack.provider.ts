import { Injectable } from '@nestjs/common';
import { PaystackClient } from './paystack.client.js';

export interface InitializeTransactionInput {
  /** Paystack requires an email at initialize time; TinyPay users enroll by
   * phone only, so callers synthesize a stable placeholder (see
   * FundFlow) — Paystack never actually emails it. */
  email: string;
  amountMinor: bigint;
  /** Internal ref (ULID), sent verbatim as Paystack's own reference — never regenerated on retry. */
  reference: string;
}

export interface InitializeTransactionResult {
  authorizationUrl: string;
  reference: string;
}

interface PaystackInitializeResponse {
  authorization_url: string;
  access_code: string;
  reference: string;
}

/**
 * No DVAs, no recipient resolution, no outbound transfers — funding is a
 * one-shot hosted Checkout page per request. The user gets a link (sent
 * off-chat by the bot), pays however Paystack's own page offers (card, bank
 * transfer, USSD, ...), and the `charge.success` webhook (verified by
 * signature) credits the wallet — see webhooks/paystack.controller.ts.
 */
@Injectable()
export class PaystackProvider {
  constructor(private readonly client: PaystackClient) {}

  async initializeTransaction(input: InitializeTransactionInput): Promise<InitializeTransactionResult> {
    const data = await this.client.request<PaystackInitializeResponse>('POST', '/transaction/initialize', {
      email: input.email,
      amount: Number(input.amountMinor),
      reference: input.reference,
    });
    return { authorizationUrl: data.authorization_url, reference: data.reference };
  }
}
