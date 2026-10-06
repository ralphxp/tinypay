import { renderEnvelope } from '../renderers/message-envelope.js';
import { encodeCallback } from './callback-codec.js';
import type { OutboundMessage } from '../../../shared/types/outbound-message.js';

export interface TelegramSendPayload {
  text: string;
  reply_markup?: { inline_keyboard: { text: string; callback_data: string }[][] };
}

/**
 * Shared by TelegramSenderService (userId-addressed sends: notifications,
 * ChannelPort.send/fanOutToMembers) and TelegramAdapter (chat-addressed
 * replies within an ongoing conversation, including groups) — the one place
 * an OutboundMessage becomes an actual Telegram send payload, so rendering,
 * masking, and callback_data encoding never diverge between the two paths.
 */
export function renderForTelegram(
  message: OutboundMessage,
  callbackContext?: { flow: string; step: string },
): TelegramSendPayload {
  const rendered = renderEnvelope(message);
  const reply_markup = rendered.choices?.length
    ? {
        inline_keyboard: [
          rendered.choices.map((choice) => {
            const label = typeof choice === 'string' ? choice : choice.label;
            const value = typeof choice === 'string' ? choice : choice.value;
            return {
              text: label,
              callback_data: callbackContext ? encodeCallback(callbackContext.flow, callbackContext.step, value) : value,
            };
          }),
        ],
      }
    : undefined;
  return { text: rendered.text, reply_markup };
}
