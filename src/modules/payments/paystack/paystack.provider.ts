import { Injectable } from '@nestjs/common';
import { PaystackClient } from './paystack.client.js';
import type {
  CreateDvaInput,
  DvaAccount,
  PspPort,
  ResolveAccountInput,
  ResolvedAccount,
  TransferInput,
  TransferResult,
  TransferStatus,
} from '../psp.port.js';

interface PaystackCustomer {
  customer_code: string;
}

interface PaystackDedicatedAccount {
  account_number: string;
  account_name: string;
  bank: { name: string };
}

interface PaystackResolvedAccount {
  account_number: string;
  account_name: string;
}

interface PaystackTransferRecipient {
  recipient_code: string;
}

interface PaystackTransfer {
  reference: string;
  transfer_code: string;
  status: string;
}

function splitName(fullName: string): { first: string; last: string } {
  const [first, ...rest] = fullName.trim().split(/\s+/);
  return { first: first ?? fullName, last: rest.join(' ') || first || fullName };
}

function mapTransferStatus(status: string): TransferStatus {
  if (status === 'success') return 'success';
  if (status === 'pending' || status === 'otp') return 'pending';
  return 'failed';
}

@Injectable()
export class PaystackProvider implements PspPort {
  constructor(private readonly client: PaystackClient) {}

  async createDva(input: CreateDvaInput): Promise<DvaAccount> {
    const { first, last } = splitName(input.fullName);
    const customer = await this.client.request<PaystackCustomer>('POST', '/customer', {
      email: input.email,
      first_name: first,
      last_name: last,
      phone: input.phone,
    });

    const account = await this.client.request<PaystackDedicatedAccount>(
      'POST',
      '/dedicated_account',
      { customer: customer.customer_code, preferred_bank: 'wema-bank' },
    );

    return {
      customerCode: customer.customer_code,
      accountNumber: account.account_number,
      accountName: account.account_name,
      bankName: account.bank.name,
    };
  }

  async resolveAccount(input: ResolveAccountInput): Promise<ResolvedAccount> {
    const resolved = await this.client.request<PaystackResolvedAccount>(
      'GET',
      `/bank/resolve?account_number=${input.accountNumber}&bank_code=${input.bankCode}`,
    );
    return {
      accountNumber: resolved.account_number,
      accountName: resolved.account_name,
      bankCode: input.bankCode,
    };
  }

  async transfer(input: TransferInput): Promise<TransferResult> {
    const recipient = await this.client.request<PaystackTransferRecipient>(
      'POST',
      '/transferrecipient',
      {
        type: 'nuban',
        name: input.accountName,
        account_number: input.accountNumber,
        bank_code: input.bankCode,
        currency: 'NGN',
      },
    );

    const transfer = await this.client.request<PaystackTransfer>('POST', '/transfer', {
      source: 'balance',
      amount: Number(input.amountMinor),
      reference: input.reference,
      recipient: recipient.recipient_code,
      reason: input.reason,
    });

    return {
      reference: transfer.reference,
      status: mapTransferStatus(transfer.status),
      providerRef: transfer.transfer_code,
    };
  }
}
