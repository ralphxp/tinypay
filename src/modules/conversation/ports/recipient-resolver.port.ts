import { Injectable } from '@nestjs/common';

export const RECIPIENT_RESOLVER_PORT = Symbol('RECIPIENT_RESOLVER_PORT');

export interface ResolvedRecipient {
  label: string;
  /** Opaque handle the ExecutorPort understands — a real impl would be an AccountRef or PSP recipient code. */
  accountRef: string;
}

export interface RecipientResolverPort {
  resolve(query: string): Promise<ResolvedRecipient>;
}

/**
 * Slice 2 stub — proves the machine shape without Paystack or the ledger.
 * Real resolution (TinyPay user lookup / Paystack account resolve) is a
 * later slice, behind this same port.
 */
@Injectable()
export class StubRecipientResolver implements RecipientResolverPort {
  /** Queries actually resolved — test-visible call log (see concurrency.spec.ts). */
  readonly calls: string[] = [];

  resolve(query: string): Promise<ResolvedRecipient> {
    this.calls.push(query);
    return Promise.resolve({ label: `Stub Recipient (${query})`, accountRef: `stub-account:${query}` });
  }
}
