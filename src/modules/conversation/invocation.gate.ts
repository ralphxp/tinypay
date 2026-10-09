import { Injectable } from '@nestjs/common';
import { isGroupSurface, type Surface } from '../../shared/types/surface.js';

const WAKE_WORD = /^\s*tinypay\b[:,]?\s*/i;
const MENTION = /@tinypay\b[:,]?\s*/i;
/** Any bare 4-digit run — PINs are 4 digits and must never survive into the utterance (guiding principle #7). */
const INLINE_PIN = /\b\d{4}\b/g;

const CANCEL_WORD = /^(?:cancel|stop|abort|nvm|never\s*mind)$/i;
const HELP_WORD = /^(?:help|\?|menu|what\s+can\s+you\s+do)$/i;
const MENU_WORD = /^(?:menu|home)$/i;
const BACK_WORD = /^back$/i;

/**
 * Global interrupts take priority over the active step's own input
 * whenever a flow is mid-turn (see ConversationService.handleText) — a step
 * never has to know how to recognize "cancel" itself.
 */
export function matchInterrupt(utterance: string): 'cancel' | 'help' | 'menu' | 'back' | undefined {
  const text = utterance.trim();
  if (CANCEL_WORD.test(text)) return 'cancel';
  if (MENU_WORD.test(text)) return 'menu';
  if (BACK_WORD.test(text)) return 'back';
  if (HELP_WORD.test(text)) return 'help';
  return undefined;
}

export interface GateInput {
  surface: Surface;
  text: string;
}

export interface GateResult {
  addressed: boolean;
  /** The message with the wake-word/mention prefix stripped, whether or not addressed. */
  utterance: string;
}

/** Strips any inline PIN-shaped token so it never reaches NLU, logs, or a slot. Idempotent. */
export function scrubPin(utterance: string): string {
  return utterance.replace(INLINE_PIN, '').replace(/\s{2,}/g, ' ').trim();
}

/**
 * DM: always addressed — no wake-word required, idle or mid-flow. A 1:1 DM
 * has no ambiguity about who a message is for, so requiring "tinypay" first
 * was friction, not disambiguation; the wake-word is still recognized and
 * stripped if someone types it out of habit, just never required. Group:
 * the wake-word or an @mention is required on every single turn, active
 * flow or not — a group chat has other participants, so silence can't be
 * read as "still talking to the bot."
 */
@Injectable()
export class InvocationGate {
  check(input: GateInput): GateResult {
    const { surface, text } = input;

    if (isGroupSurface(surface)) {
      const wakeMatch = WAKE_WORD.exec(text);
      if (wakeMatch) {
        return { addressed: true, utterance: text.slice(wakeMatch[0].length).trim() };
      }
      const mentionMatch = MENTION.exec(text);
      if (mentionMatch) {
        return { addressed: true, utterance: text.replace(MENTION, '').trim() };
      }
      return { addressed: false, utterance: text.trim() };
    }

    const wakeMatch = WAKE_WORD.exec(text);
    const stripped = wakeMatch ? text.slice(wakeMatch[0].length).trim() : text.trim();
    return { addressed: true, utterance: stripped };
  }
}
