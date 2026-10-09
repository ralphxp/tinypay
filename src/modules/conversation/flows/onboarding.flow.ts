import { StepError } from '../../../common/errors/domain-errors.js';
import type { UserService } from '../../identity/user.service.js';
import type { FlowDef } from '../types.js';
import { inputText } from './flow-input.js';

export interface OnboardingFlowDeps {
  users: UserService;
}

/** Permissive on purpose — this gates "looks like an email", not RFC 5322. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * onboarding: await_email -> save_email -> onboarding_complete.
 *
 * Seeded once, right after a phone is first linked (Telegram's contact-share,
 * WhatsApp's auto-enroll) — phone is still required (it's the cross-channel
 * identity join key, see UserService), this only adds the one thing a phone
 * number can't give us: an email, so Paystack's receipt reaches the actual
 * user instead of the synthetic address fund.flow.ts invents. fullName comes
 * for free from Telegram's contact card where available (see
 * telegram.adapter.ts's handleContactShare) — this flow never asks for it.
 */
export function createOnboardingFlow(deps: OnboardingFlowDeps): FlowDef {
  return {
    entry: 'await_email',
    terminal: ['onboarding_complete'],
    slotSteps: [{ step: 'await_email', slot: 'email' }],
    steps: {
      await_email: {
        prompt: () => ({ text: "One last thing — what's your email? We'll use it for payment receipts." }),
        validate: (evt) => {
          const raw = inputText(evt);
          if (!raw) throw new StepError('Enter your email, e.g. you@example.com.');
          const email = raw.trim().toLowerCase();
          if (!EMAIL_SHAPE.test(email)) throw new StepError("That doesn't look like an email — try again.");
          return { slots: { email } };
        },
        next: () => 'save_email',
        maxAttempts: 5,
      },

      save_email: {
        auto: true,
        prompt: () => ({ text: 'Setting things up…' }),
        validate: () => ({}),
        next: async (session) => {
          const userId = session.slots.userId as string;
          const email = session.slots.email as string;
          await deps.users.updateEmail(userId, email);
          return 'onboarding_complete';
        },
      },

      onboarding_complete: {
        prompt: () => ({
          text: "You're all set! Try 'balance', 'fund', 'airtime', or 'data'.",
        }),
        validate: () => ({}),
        next: () => 'onboarding_complete',
      },
    },
  };
}
