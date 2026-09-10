import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { PrismaService } from '../../database/prisma.service.js';
import { LedgerService } from '../../../modules/wallet/ledger.service.js';
import { SETTLEMENT_QUEUE } from '../queue.constants.js';

interface PaystackWebhookEvent {
  event: string;
  data: {
    id: number;
    reference: string;
    amount: number;
    customer?: { customer_code: string };
  };
}

/** Turns inbound PSP webhook events into ledger postings (guiding principle #1). */
@Processor(SETTLEMENT_QUEUE)
export class SettlementProcessor extends WorkerHost {
  private readonly logger = new Logger(SettlementProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {
    super();
  }

  async process(job: Job<PaystackWebhookEvent>): Promise<void> {
    const event = job.data;

    switch (event.event) {
      case 'charge.success':
        return this.handleChargeSuccess(event);
      case 'transfer.success':
      case 'transfer.failed':
        return this.handleTransferOutcome(event);
      default:
        this.logger.debug(`Ignoring unhandled Paystack event: ${event.event}`);
    }
  }

  private async handleChargeSuccess(event: PaystackWebhookEvent): Promise<void> {
    const { customer, amount, reference } = event.data;
    if (!customer) return;

    const user = await this.prisma.user.findUnique({
      where: { paystackCustomerCode: customer.customer_code },
    });
    if (!user) {
      throw new Error(`No user found for Paystack customer ${customer.customer_code}`);
    }

    const amountMinor = BigInt(amount);
    await this.ledger.postEntry({
      externalRef: `paystack:${reference}`,
      kind: 'fund',
      legs: [
        {
          accountRef: { ownerType: 'system', ownerId: 'psp_settlement_ngn', kind: 'psp_settlement' },
          amountMinor: -amountMinor,
        },
        {
          accountRef: { ownerType: 'user', ownerId: user.id, kind: 'wallet' },
          amountMinor,
        },
      ],
    });
  }

  /** Reconciles a payout left `pending` by PayoutProcessor once Paystack confirms the outcome. */
  private async handleTransferOutcome(event: PaystackWebhookEvent): Promise<void> {
    const txn = await this.prisma.transaction.findUnique({ where: { ref: event.data.reference } });
    if (!txn || txn.status !== 'pending') return;

    if (event.event === 'transfer.success') {
      await this.prisma.transaction.update({ where: { id: txn.id }, data: { status: 'completed' } });
      return;
    }

    await this.prisma.transaction.update({ where: { id: txn.id }, data: { status: 'failed' } });
    await this.ledger.postEntry({
      externalRef: `reversal:${txn.ref}`,
      kind: 'reversal',
      legs: [
        { accountRef: { ownerType: 'user', ownerId: txn.userId, kind: 'wallet' }, amountMinor: txn.amountMinor },
        {
          accountRef: { ownerType: 'system', ownerId: 'psp_settlement_ngn', kind: 'psp_settlement' },
          amountMinor: -txn.amountMinor,
        },
      ],
    });
  }
}
