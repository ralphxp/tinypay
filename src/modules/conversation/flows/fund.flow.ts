import { ulid } from 'ulid';
import { StepError } from '../../../common/errors/domain-errors.js';
import { parseAmountMinor } from '../../nlu/normalizer.js';
import { formatNaira } from '../../../shared/utils/format-money.js';
import { computeFundFeeMinor } from '../../../shared/utils/fees.js';
import type { PaystackProvider } from '../../payments/paystack/paystack.provider.js';
import type { WalletService } from '../../wallet/wallet.service.js';
import type { UserService } from '../../identity/user.service.js';
import type { FlowDef } from '../types.js';
import { inputText } from './flow-input.js';

export interface FundFlowDeps {
  wallet: WalletService;
  paystack: PaystackProvider;
  users: UserService;
}

/** Paystack requires an email at initialize time. Used only when the user
 * hasn't given a real one yet (onboarding.flow.ts asks, but an existing user
 * from before that shipped may still have none) — Paystack never actually
 * emails this placeholder, so its own receipt only reaches a real address. */
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
 * code lookup needed. The wallet is always credited exactly the amount the
 * user asked for; computeFundFeeMinor's 1.5% is charged on top at Paystack's
 * checkout, never deducted from what lands in the wallet (see fees.ts).
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
          const feeMinor = computeFundFeeMinor(amountMinor);
          const chargeMinor = amountMinor + feeMinor;
          const ref = `tinypay-${ulid()}`;

          await deps.wallet.reserveFund({ userId, ref, amountMinor, feeMinor });

          const user = await deps.users.findById(userId);
          let result;
          try {
            result = await deps.paystack.initializeTransaction({
              email: user?.email ?? syntheticEmail(userId),
              amountMinor: chargeMinor,
              reference: ref,
            });
          } catch {
            throw new StepError("Couldn't start that payment — please try again in a moment.");
          }

          session.slots.feeMinor = feeMinor.toString();
          session.slots.paymentUrl = result.authorizationUrl;
          return 'funding_initiated';
        },
      },

      funding_initiated: {
        prompt: (session) => {
          const amountMinor = BigInt(session.slots.amountMinor as string);
          const feeMinor = BigInt(session.slots.feeMinor as string);
          return {
            text:
              `Tap to pay ${formatNaira(amountMinor + feeMinor)} ` +
              `(${formatNaira(amountMinor)} + ${formatNaira(feeMinor)} processing fee) — ` +
              `your wallet credits ${formatNaira(amountMinor)} automatically once payment completes:\n${session.slots.paymentUrl}`,
          };
        },
        validate: () => ({}),
        next: () => 'funding_initiated',
      },
    },
  };
}
