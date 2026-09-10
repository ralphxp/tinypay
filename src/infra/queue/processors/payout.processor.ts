import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { PrismaService } from '../../database/prisma.service.js';
import { LedgerService } from '../../../modules/wallet/ledger.service.js';
import { PaymentsOrchestrator } from '../../../modules/payments/payments.orchestrator.js';
import { PaystackApiError } from '../../../modules/payments/paystack/paystack.client.js';
import { PAYOUT_QUEUE } from '../queue.constants.js';

export interface PayoutJobData {
  transactionId: string;
  accountNumber: string;
  bankCode: string;
  accountName: string;
  /** Stringified bigint — BullMQ job data is JSON, which can't carry a bigint. */
  amountMinor: string;
}

/**
 * Executes an outbound transfer for a withdrawal/external-bank transfer whose
 * debit has already been posted to the ledger (psp_settlement leg). On a
 * definitive PSP failure we reverse that debit so the user isn't left out of
 * pocket. We don't auto-retry (attempts: 1, set at enqueue time) because a
 * retry after we've already reversed risks a duplicate real-world payout —
 * Paystack's own reference-based idempotency covers transient failures
 * before a definitive status is known; anything past that needs manual
 * reconciliation, which is out of scope for this pass.
 */
@Processor(PAYOUT_QUEUE)
export class PayoutProcessor extends WorkerHost {
  private readonly logger = new Logger(PayoutProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrator: PaymentsOrchestrator,
    private readonly ledger: LedgerService,
  ) {
    super();
  }

  async process(job: Job<PayoutJobData>): Promise<void> {
    const { transactionId, accountNumber, bankCode, accountName, amountMinor } = job.data;
    const txn = await this.prisma.transaction.findUniqueOrThrow({ where: { id: transactionId } });
    const psp = this.orchestrator.forCurrency('NGN');

    try {
      const result = await psp.transfer({
        amountMinor: BigInt(amountMinor),
        accountNumber,
        bankCode,
        accountName,
        reference: txn.ref,
      });

      await this.prisma.transaction.update({
        where: { id: transactionId },
        data: {
          status: result.status === 'failed' ? 'failed' : 'pending',
          pspRef: result.providerRef,
        },
      });

      if (result.status === 'failed') {
        await this.reverse(txn.userId, txn.ref, BigInt(amountMinor));
      }
    } catch (err) {
      if (!(err instanceof PaystackApiError)) throw err;

      this.logger.warn(`Payout for transaction ${transactionId} failed: ${err.message}`);
      await this.prisma.transaction.update({
        where: { id: transactionId },
        data: { status: 'failed' },
      });
      await this.reverse(txn.userId, txn.ref, BigInt(amountMinor));
    }
  }

  private async reverse(userId: string, ref: string, amountMinor: bigint): Promise<void> {
    await this.ledger.postEntry({
      externalRef: `reversal:${ref}`,
      kind: 'reversal',
      legs: [
        { accountRef: { ownerType: 'user', ownerId: userId, kind: 'wallet' }, amountMinor },
        {
          accountRef: { ownerType: 'system', ownerId: 'psp_settlement_ngn', kind: 'psp_settlement' },
          amountMinor: -amountMinor,
        },
      ],
    });
  }
}
