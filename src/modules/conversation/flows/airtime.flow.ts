import { ulid } from 'ulid';
import type { Network } from '@prisma/client';
import { StepError, InsufficientBalanceError } from '../../../common/errors/domain-errors.js';
import { parseAmountMinor, normalizeNetwork } from '../../nlu/normalizer.js';
import { formatNaira } from '../../../shared/utils/format-money.js';
import { NETWORK_LABEL } from '../../../shared/utils/network-label.js';
import type { WalletService } from '../../wallet/wallet.service.js';
import type { BillerPort } from '../../payments/biller.port.js';
import type { NotificationSink } from '../../notifications/notification.port.js';
import type { FlowDef } from '../types.js';
import { inputText, isAffirmative } from './flow-input.js';
import { createRecipientPhoneStep } from './recipient-phone-step.js';

export interface AirtimeFlowDeps {
  wallet: WalletService;
  biller: BillerPort;
  notifications: NotificationSink;
}

/**
 * airtime: await_network -> await_amount -> await_recipient_phone ->
 * await_confirm -> execute_purchase -> done.
 *
 * Can buy for someone else, not just the buyer: await_recipient_phone
 * defaults to the buyer's own number (one-tap 'Myself', prefilled from
 * `selfPhone`) but accepts any other phone number too — skipped entirely
 * when the opening message already named a recipient (ConversationService
 * parses an inline phone number straight into the `recipientPhone` slot).
 * Balance-before-provider: reserveDebit() takes the money before
 * buyAirtime() is ever called, mirroring the old ledger-before-PSP payout
 * discipline; a biller failure refunds via WalletService.refundFailed
 * rather than leaving a silent debit. A biller `pending` result (still
 * processing with the network) lands on `processing`, not `done` — never
 * refunded; there's no webhook for the final outcome yet, only a requery
 * endpoint nothing polls (BigisubProvider.requeryTransaction), so the user
 * finds out via a later `history` check.
 */
export function createAirtimeFlow(deps: AirtimeFlowDeps): FlowDef {
  return {
    entry: 'await_network',
    terminal: ['done', 'processing'],
    slotSteps: [
      { step: 'await_network', slot: 'network' },
      { step: 'await_amount', slot: 'amountMinor' },
      { step: 'await_recipient_phone', slot: 'recipientPhone' },
      { step: 'await_confirm', slot: 'confirmed' },
    ],
    steps: {
      await_network: {
        prompt: () => ({ text: 'Which network?', choices: ['MTN', 'Glo', 'Airtel', '9mobile'] }),
        validate: (evt) => {
          const raw = inputText(evt);
          if (!raw) throw new StepError('Which network — MTN, Glo, Airtel, or 9mobile?');
          const network = normalizeNetwork(raw);
          return { slots: { network } };
        },
        next: () => 'await_amount',
      },

      await_amount: {
        prompt: (session) => ({
          text: `How much ${NETWORK_LABEL[session.slots.network as Network]} airtime?`,
          choices: ['₦100', '₦200', '₦500', '₦1000'],
        }),
        validate: (evt) => {
          const raw = inputText(evt);
          if (!raw) throw new StepError('Enter an amount, e.g. 500 or 5k.');
          const amountMinor = parseAmountMinor(raw);
          return { slots: { amountMinor: amountMinor.toString() } };
        },
        next: () => 'await_recipient_phone',
      },

      await_recipient_phone: createRecipientPhoneStep('await_confirm'),

      await_confirm: {
        prompt: (session) => ({
          text: `Buy ${formatNaira(BigInt(session.slots.amountMinor as string))} ${NETWORK_LABEL[session.slots.network as Network]} airtime for ${session.slots.recipientPhone}? Reply yes to confirm.`,
          choices: ['yes', 'cancel'],
        }),
        validate: (evt) => {
          if (!isAffirmative(evt)) throw new StepError("Reply 'yes' to confirm, or 'cancel' to abort.");
          return {};
        },
        next: () => 'execute_purchase',
      },

      execute_purchase: {
        auto: true,
        prompt: () => ({ text: 'Processing…' }),
        validate: () => ({}),
        next: async (session) => {
          const userId = session.slots.userId as string;
          const network = session.slots.network as Network;
          const amountMinor = BigInt(session.slots.amountMinor as string);
          const recipientPhone = session.slots.recipientPhone as string;
          const ref = `tinypay:${ulid()}`;

          let reservation;
          try {
            reservation = await deps.wallet.reserveDebit({
              userId,
              ref,
              amountMinor,
              type: 'airtime',
              network,
              recipientPhone,
            });
          } catch (err) {
            if (err instanceof InsufficientBalanceError) {
              throw new StepError('Insufficient wallet balance — fund your wallet first.');
            }
            throw err;
          }

          let result;
          try {
            result = await deps.biller.buyAirtime({ network, phone: recipientPhone, amountMinor, reference: ref });
          } catch (err) {
            const reason = err instanceof Error ? err.message : 'Provider error';
            await deps.wallet.refundFailed(reservation.transactionId, reason);
            deps.notifications.emit({ kind: 'purchase_failed', userId, type: 'airtime', amountMinor, reason, ref });
            throw new StepError("Couldn't complete that airtime purchase — your wallet wasn't charged.");
          }

          if (result.status === 'failed') {
            await deps.wallet.refundFailed(reservation.transactionId, 'Biller declined the purchase');
            deps.notifications.emit({
              kind: 'purchase_failed',
              userId,
              type: 'airtime',
              amountMinor,
              reason: 'Biller declined the purchase',
              ref,
            });
            throw new StepError("That airtime purchase failed — your wallet wasn't charged.");
          }

          if (result.status === 'pending') {
            return 'processing';
          }

          await deps.wallet.markCompleted(reservation.transactionId, result.providerRef);
          deps.notifications.emit({
            kind: 'purchase_completed',
            userId,
            type: 'airtime',
            network,
            recipientPhone,
            amountMinor,
            ref,
          });
          return 'done';
        },
      },

      done: {
        prompt: (session) => ({
          text: `Done! ${formatNaira(BigInt(session.slots.amountMinor as string))} ${NETWORK_LABEL[session.slots.network as Network]} airtime sent to ${session.slots.recipientPhone}.`,
        }),
        validate: () => ({}),
        next: () => 'done',
      },

      processing: {
        prompt: (session) => ({
          text: `Your ${formatNaira(BigInt(session.slots.amountMinor as string))} ${NETWORK_LABEL[session.slots.network as Network]} airtime purchase is still processing with the network — check 'history' shortly for the final result.`,
        }),
        validate: () => ({}),
        next: () => 'processing',
      },
    },
  };
}
