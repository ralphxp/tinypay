import { ulid } from 'ulid';
import { StepError } from '../../../common/errors/domain-errors.js';
import { parseAmountMinor } from '../../nlu/normalizer.js';
import { formatNaira } from '../../../shared/utils/format-money.js';
import type { PaystackProvider } from '../../payments/paystack/paystack.provider.js';
import type { WalletService } from '../../wallet/wallet.service.js';
import type { FlowDef } from '../types.js';
import { inputText } from './flow-input.js';

export interface FundFlowDeps {
  wallet: WalletService;
  paystack: PaystackProvider;
}

/** Paystack requires an email at initialize time; TinyPay never collects
 * one (phone-only identity) — this placeholder is never actually emailed. */
function syntheticEmail(userId: string): string {
  return `${userId}@users.tinypay.ng`;
}

/**
 * fund: await_amount -> initiate_funding -> funding_initiated.
 *
 * No DVAs: funding is a one-shot hosted Paystack Checkout link per request,
 * not a standing per-user bank account. reserveFund() creates a `pending`
 * WalletTransaction BEFORE the user ever reaches Paystack, keyed on the same
 * `ref` sent as Paystack's `reference` — that ref is how the charge.success
 * webhook later finds which user/amount to credit (see
 * webhooks/paystack.controller.ts, WalletService.completeFund), no customer-
 * code lookup needed.
 */
export function createFundFlow(deps: FundFlowDeps): FlowDef {
  return {
    entry: 'await_amount',
    terminal: ['funding_initiated'],
    slotSteps: [{ step: 'await_amount', slot: 'amountMinor' }],
    steps: {
      await_amount: {
        prompt: () => ({
          text: 'How much would you like to fund your wallet?',
          choices: ['₦500', '₦1000', '₦2000', '₦5000'],
        }),
        validate: (evt) => {
          const raw = inputText(evt);
          if (!raw) throw new StepError('Enter an amount, e.g. 500 or 5k.');
          const amountMinor = parseAmountMinor(raw);
          return { slots: { amountMinor: amountMinor.toString() } };
        },
        next: () => 'initiate_funding',
      },

      initiate_funding: {
        auto: true,
        prompt: () => ({ text: 'Generating your payment link…' }),
        validate: () => ({}),
        next: async (session) => {
          const userId = session.slots.userId as string;
          const amountMinor = BigInt(session.slots.amountMinor as string);
          const ref = `tinypay-${ulid()}`;

          await deps.wallet.reserveFund({ userId, ref, amountMinor });

          let result;
          try {
            result = await deps.paystack.initializeTransaction({
              email: syntheticEmail(userId),
              amountMinor,
              reference: ref,
            });
          } catch {
            throw new StepError("Couldn't start that payment — please try again in a moment.");
          }

          session.slots.paymentUrl = result.authorizationUrl;
          return 'funding_initiated';
        },
      },

      funding_initiated: {
        prompt: (session) => ({
          text: `Tap to pay ${formatNaira(BigInt(session.slots.amountMinor as string))} — your wallet credits automatically once payment completes:\n${session.slots.paymentUrl}`,
        }),
        validate: () => ({}),
        next: () => 'funding_initiated',
      },
    },
  };
}
