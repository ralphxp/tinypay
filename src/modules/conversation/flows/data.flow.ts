import { ulid } from 'ulid';
import type { Network } from '@prisma/client';
import { StepError, InsufficientBalanceError } from '../../../common/errors/domain-errors.js';
import { normalizeNetwork } from '../../nlu/normalizer.js';
import { formatNaira } from '../../../shared/utils/format-money.js';
import { NETWORK_LABEL } from '../../../shared/utils/network-label.js';
import type { DataPlan } from '../../payments/biller.port.js';
import type { WalletService } from '../../wallet/wallet.service.js';
import type { BillerPort } from '../../payments/biller.port.js';
import type { NotificationSink } from '../../notifications/notification.port.js';
import type { Choice } from '../../../shared/types/outbound-message.js';
import type { FlowDef } from '../types.js';
import { inputText, isAffirmative } from './flow-input.js';
import { createRecipientPhoneStep } from './recipient-phone-step.js';

export interface DataFlowDeps {
  wallet: WalletService;
  biller: BillerPort;
  notifications: NotificationSink;
}

function labelFor(plan: DataPlan): string {
  return `${plan.label} — ${formatNaira(plan.priceMinor)}`;
}

/** {label, value: planCode} — the tapped value must stay short (Telegram's
 * 64-byte callback_data cap, see callback-codec.ts); a plan's label alone
 * ("1GB — 30 days — ₦435.00") would often blow that budget once combined
 * with the flow/step prefix. */
function choiceFor(plan: DataPlan): Choice {
  return { label: labelFor(plan), value: plan.planCode };
}

/** Undoes the bigint->string stashing from await_network's next() (see below). */
function parseStashedPlans(session: { slots: Record<string, unknown> }): DataPlan[] {
  const raw = JSON.parse(session.slots.availablePlans as string) as (Omit<DataPlan, 'priceMinor'> & {
    priceMinor: string;
  })[];
  return raw.map((p) => ({ ...p, priceMinor: BigInt(p.priceMinor) }));
}

/**
 * data: await_network -> await_plan -> await_recipient_phone ->
 * await_confirm -> execute_purchase -> done | processing.
 *
 * Plans are fetched live from Bigisub (GET .../vtu/data/plans/, see
 * BigisubProvider.listDataPlans) rather than a static catalog — await_network's
 * next() does the fetch (StepDef.prompt is synchronous, so the plan list is
 * stashed in a slot for await_plan's prompt to read back out). Can buy for
 * someone else, not just the buyer — see recipient-phone-step.ts. Otherwise
 * mirrors airtime.flow.ts: balance-before-provider, refund-on-failure, and a
 * biller `pending` result (still processing with the network) lands on
 * `processing`, not `done` — never refunded.
 */
export function createDataFlow(deps: DataFlowDeps): FlowDef {
  return {
    entry: 'await_network',
    terminal: ['done', 'processing'],
    slotSteps: [
      { step: 'await_network', slot: 'network' },
      { step: 'await_plan', slot: 'planCode' },
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
        next: async (session) => {
          const network = session.slots.network as Network;
          let plans: DataPlan[];
          try {
            plans = await deps.biller.listDataPlans(network);
          } catch {
            throw new StepError("Couldn't load data plans right now — please try again shortly.");
          }
          if (plans.length === 0) {
            throw new StepError(`No ${NETWORK_LABEL[network]} data plans are available right now.`);
          }
          // JSON can't serialize bigint — stash priceMinor as a string, undone in await_plan's prompt/next.
          session.slots.availablePlans = JSON.stringify(
            plans.map((p) => ({ ...p, priceMinor: p.priceMinor.toString() })),
          );
          return 'await_plan';
        },
      },

      await_plan: {
        prompt: (session) => {
          const network = session.slots.network as Network;
          const plans = parseStashedPlans(session);
          return {
            text: `Pick a ${NETWORK_LABEL[network]} data plan:`,
            choices: plans.map(choiceFor),
          };
        },
        validate: (evt) => {
          const raw = inputText(evt);
          if (!raw) throw new StepError('Pick one of the listed plans.');
          return { slots: { pickedPlan: raw } };
        },
        next: (session) => {
          const plans = parseStashedPlans(session);
          const picked = session.slots.pickedPlan as string;
          // A tap sends back planCode directly; free text (typing the label
          // verbatim instead of tapping) is supported as a fallback.
          const plan = plans.find((p) => p.planCode === picked || labelFor(p) === picked);
          if (!plan) throw new StepError('Pick one of the listed plans.');
          session.slots.planCode = plan.planCode;
          session.slots.planLabelResolved = plan.label;
          session.slots.priceMinor = plan.priceMinor.toString();
          return 'await_recipient_phone';
        },
      },

      await_recipient_phone: createRecipientPhoneStep('await_confirm'),

      await_confirm: {
        prompt: (session) => ({
          text: `Buy ${session.slots.planLabelResolved} ${NETWORK_LABEL[session.slots.network as Network]} data (${formatNaira(BigInt(session.slots.priceMinor as string))}) for ${session.slots.recipientPhone}? Reply yes to confirm.`,
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
          const planCode = session.slots.planCode as string;
          const amountMinor = BigInt(session.slots.priceMinor as string);
          const recipientPhone = session.slots.recipientPhone as string;
          const ref = `tinypay:${ulid()}`;

          let reservation;
          try {
            reservation = await deps.wallet.reserveDebit({
              userId,
              ref,
              amountMinor,
              type: 'data',
              network,
              recipientPhone,
              planCode,
            });
          } catch (err) {
            if (err instanceof InsufficientBalanceError) {
              throw new StepError('Insufficient wallet balance — fund your wallet first.');
            }
            throw err;
          }

          let result;
          try {
            result = await deps.biller.buyData({ network, phone: recipientPhone, planCode, reference: ref });
          } catch (err) {
            const reason = err instanceof Error ? err.message : 'Provider error';
            await deps.wallet.refundFailed(reservation.transactionId, reason);
            deps.notifications.emit({ kind: 'purchase_failed', userId, type: 'data', amountMinor, reason, ref });
            throw new StepError("Couldn't complete that data purchase — your wallet wasn't charged.");
          }

          if (result.status === 'failed') {
            await deps.wallet.refundFailed(reservation.transactionId, 'Biller declined the purchase');
            deps.notifications.emit({
              kind: 'purchase_failed',
              userId,
              type: 'data',
              amountMinor,
              reason: 'Biller declined the purchase',
              ref,
            });
            throw new StepError("That data purchase failed — your wallet wasn't charged.");
          }

          if (result.status === 'pending') {
            // Still processing with the network — not a failure, so never
            // refund. The transaction stays 'pending' (reserveDebit's own
            // initial status); there's no webhook, only a requery endpoint
            // nothing polls yet (BigisubProvider.requeryTransaction), so the
            // user finds out the final outcome via a later `history` check.
            return 'processing';
          }

          await deps.wallet.markCompleted(reservation.transactionId, result.providerRef);
          deps.notifications.emit({
            kind: 'purchase_completed',
            userId,
            type: 'data',
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
          text: `Done! ${session.slots.planLabelResolved} ${NETWORK_LABEL[session.slots.network as Network]} data sent to ${session.slots.recipientPhone}.`,
        }),
        validate: () => ({}),
        next: () => 'done',
      },

      processing: {
        prompt: (session) => ({
          text: `Your ${session.slots.planLabelResolved} ${NETWORK_LABEL[session.slots.network as Network]} data purchase is still processing with the network — check 'history' shortly for the final result.`,
        }),
        validate: () => ({}),
        next: () => 'processing',
      },
    },
  };
}
