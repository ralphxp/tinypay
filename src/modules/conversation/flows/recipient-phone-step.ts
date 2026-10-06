import { StepError } from '../../../common/errors/domain-errors.js';
import { normalizePhone, isLikelyPhoneNumber } from '../../../shared/utils/phone.js';
import type { StepDef } from '../types.js';
import { inputText } from './flow-input.js';

const SELF_WORDS = new Set(['me', 'myself', 'self', 'myself.']);

/**
 * Shared by airtime.flow.ts and data.flow.ts: asks who the purchase is for.
 * Defaults to the buyer (`selfPhone`, prefilled by ConversationService from
 * their own enrolled phone) via a one-tap 'Myself' choice, or accepts any
 * other phone number typed/tapped — so a user can buy airtime/data for
 * someone else, not just themselves. Skipped entirely when the opening
 * message already named a recipient (phoneRaw parsed by grammar — see
 * ConversationService.handleAirtimeIntent/handleDataIntent).
 */
export function createRecipientPhoneStep(nextStepId: string): StepDef {
  return {
    prompt: () => ({
      text: "Who's this for? Reply with their phone number, or 'Myself'.",
      choices: ['Myself'],
    }),
    validate: (evt) => {
      const raw = inputText(evt);
      if (!raw) throw new StepError("Reply with a phone number, or 'Myself'.");
      return { slots: { recipientPhoneRaw: raw } };
    },
    next: (session) => {
      // Seeding (ConversationService.seedFlow) can prefill recipientPhone
      // directly from the opening message's phoneRaw and still run this
      // step's next() without ever calling validate() — same pass-through
      // treatment every other prefilled slotStep gets. Nothing left to do.
      if (session.slots.recipientPhone) return nextStepId;

      const raw = session.slots.recipientPhoneRaw as string;
      if (SELF_WORDS.has(raw.trim().toLowerCase())) {
        session.slots.recipientPhone = session.slots.selfPhone;
        return nextStepId;
      }
      if (!isLikelyPhoneNumber(raw)) {
        throw new StepError("That doesn't look like a phone number — try again, or reply 'Myself'.");
      }
      session.slots.recipientPhone = normalizePhone(raw);
      return nextStepId;
    },
  };
}
