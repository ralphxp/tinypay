import type { Update, MessageEntity } from 'grammy/types';
import type { ChannelName } from '../../conversation/types.js';
import { decodeCallback } from './callback-codec.js';

const WAKE_WORD = /^\s*tinypay\b[:,]?\s*/i;

function mentionsBotUsername(text: string, entities: MessageEntity[] | undefined, botUsername: string): boolean {
  if (WAKE_WORD.test(text)) return true;
  if (!entities) return false;
  return entities.some((e) => e.type === 'mention' && text.slice(e.offset, e.offset + e.length) === `@${botUsername}`);
}

/**
 * Pure normalization of a Telegram Update into the channel-agnostic
 * ChannelInboundEvent — no network calls, no identity lookup (that's the
 * adapter's job, since it needs UserService). Returns null for update types
 * this bot doesn't handle (edited messages, channel posts, ...).
 */
export function normalizeUpdate(update: Update, botUsername: string): ChannelInboundEventDraft | null {
  if (update.callback_query) {
    const cq = update.callback_query;
    const chat = cq.message?.chat;
    if (!chat || !cq.data) return null;
    const decoded = decodeCallback(cq.data);
    return {
      channel: chat.type === 'private' ? 'telegram_dm' : 'telegram_group',
      chatRef: String(chat.id),
      text: '',
      mentionsBot: true, // a tap is always addressed — it only exists because we rendered it
      isGroup: chat.type !== 'private',
      groupId: chat.type !== 'private' ? String(chat.id) : undefined,
      structured: decoded ?? undefined,
      telegramUserId: cq.from ? String(cq.from.id) : undefined,
      callbackQueryId: cq.id,
    };
  }

  const message = update.message;
  if (!message?.text || !message.from) return null;

  const isGroup = message.chat.type !== 'private';
  return {
    channel: isGroup ? 'telegram_group' : 'telegram_dm',
    chatRef: String(message.chat.id),
    text: message.text,
    mentionsBot: mentionsBotUsername(message.text, message.entities, botUsername),
    isGroup,
    groupId: isGroup ? String(message.chat.id) : undefined,
    telegramUserId: String(message.from.id),
  };
}

/** Internal draft shape normalizeUpdate produces — the adapter adds userId/senderPhone
 * after resolving telegramUserId, then narrows this to a real ChannelInboundEvent. */
export interface ChannelInboundEventDraft {
  channel: ChannelName;
  chatRef: string;
  text: string;
  mentionsBot: boolean;
  isGroup: boolean;
  groupId?: string;
  structured?: { flow: string; step: string; value: string };
  telegramUserId?: string;
  callbackQueryId?: string;
}
