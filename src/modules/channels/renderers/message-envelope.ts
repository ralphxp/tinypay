import type { OutboundMessage } from '../../../shared/types/outbound-message.js';

/** NUBAN account numbers are always exactly 10 digits (see shared/utils/phone.ts) — the
 * pattern this masks. A money amount happening to also be a bare 10-digit run is an
 * accepted, documented false positive; amounts are rendered in minor units, which for
 * any transfer within KYC tier caps essentially never lands on exactly 10 digits. */
const NUBAN = /\b\d{10}\b/g;

/** Replaces every NUBAN-shaped run with a masked form keeping only the last 4 digits
 * (e.g. `0123456789` -> `•••6789`) — account numbers must never appear in full in any
 * rendered output (chat text, notification, or log-adjacent user-facing copy). */
export function maskAccountNumbers(text: string): string {
  return text.replace(NUBAN, (match) => `•••${match.slice(-4)}`);
}

const HEADER = 'TinyPay';
const DIVIDER = '───────────';

/**
 * The shared message envelope: a header line, a divider, the (masked) body,
 * and a closing divider — makes bot output scannable in a busy chat. This
 * function is channel-agnostic in (OutboundMessage) and channel-agnostic
 * out (still just text + choices); a channel adapter (TelegramAdapter, a
 * future WhatsApp adapter) is responsible for turning `choices` into its own
 * native affordance (inline keyboard, quick-reply buttons, ...).
 */
export function renderEnvelope(message: OutboundMessage): OutboundMessage {
  const body = maskAccountNumbers(message.text);
  const text = [HEADER, DIVIDER, body, DIVIDER].join('\n');
  return { text, choices: message.choices };
}
