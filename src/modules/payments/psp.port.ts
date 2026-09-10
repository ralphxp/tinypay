export interface CreateDvaInput {
  userId: string;
  email: string;
  fullName: string;
  phone: string;
}

export interface DvaAccount {
  customerCode: string;
  accountNumber: string;
  accountName: string;
  bankName: string;
}

export interface ResolveAccountInput {
  accountNumber: string;
  bankCode: string;
}

export interface ResolvedAccount {
  accountNumber: string;
  accountName: string;
  bankCode: string;
}

export interface TransferInput {
  amountMinor: bigint;
  accountNumber: string;
  bankCode: string;
  accountName: string;
  /** Idempotency key for the transfer request itself. */
  reference: string;
  reason?: string;
}

export type TransferStatus = 'success' | 'pending' | 'failed';

export interface TransferResult {
  reference: string;
  status: TransferStatus;
  providerRef: string;
}

/**
 * Currency-scoped payment service provider contract. Shaped around Paystack
 * (NGN) for now; USD/Stripe (P4) will need its own port since PaymentIntents
 * + Connect don't map cleanly onto DVA-style virtual accounts.
 */
export interface PspPort {
  createDva(input: CreateDvaInput): Promise<DvaAccount>;
  resolveAccount(input: ResolveAccountInput): Promise<ResolvedAccount>;
  transfer(input: TransferInput): Promise<TransferResult>;
}

export const PSP_PORT = Symbol('PSP_PORT');
