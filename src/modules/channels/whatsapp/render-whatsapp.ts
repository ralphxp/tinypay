import { renderEnvelope } from '../renderers/message-envelope.js';
import type { OutboundMessage } from '../../../shared/types/outbound-message.js';

/**
 * Twilio's WhatsApp sandbox doesn't support interactive reply buttons
 * without pre-approved content templates — unlike Telegram's inline
 * keyboards, every WhatsApp choice is a numbered plain-text line, and every
 * inbound reply is free text (see WhatsAppAdapter — there's no tap/
 * callback_data equivalent here at all; the FSM's own flow-input.ts already
 * accepts a number or the label text interchangeably via the same free-text
 * path isActiveFlow DM replies use on Telegram).
 */
export function renderForWhatsApp(message: OutboundMessage): string {
  const rendered = renderEnvelope(message);
  if (!rendered.choices?.length) return rendered.text;

  const lines = rendered.choices.map((choice, i) => {
    const label = typeof choice === 'string' ? choice : choice.label;
    return `${i + 1}. ${label}`;
  });
  return [rendered.text, '', ...lines].join('\n');
}
