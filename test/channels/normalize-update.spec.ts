import type { Update } from 'grammy/types';
import { normalizeUpdate } from '../../src/modules/channels/telegram/normalize-update.js';
import { encodeCallback, decodeCallback } from '../../src/modules/channels/telegram/callback-codec.js';

function dmMessageUpdate(text: string, opts: { entities?: Update['message']['entities'] } = {}): Update {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      date: 0,
      chat: { id: 111, type: 'private', first_name: 'Ada' },
      from: { id: 111, is_bot: false, first_name: 'Ada' },
      text,
      entities: opts.entities,
    },
  } as unknown as Update;
}

function groupMessageUpdate(text: string, opts: { entities?: Update['message']['entities'] } = {}): Update {
  return {
    update_id: 2,
    message: {
      message_id: 2,
      date: 0,
      chat: { id: -500, type: 'group', title: 'Roommates' },
      from: { id: 222, is_bot: false, first_name: 'Bo' },
      text,
      entities: opts.entities,
    },
  } as unknown as Update;
}

function callbackQueryUpdate(data: string, chatType: 'private' | 'group' = 'private'): Update {
  return {
    update_id: 3,
    callback_query: {
      id: 'cbq_1',
      from: { id: 333, is_bot: false, first_name: 'Chi' },
      chat_instance: 'x',
      data,
      message: {
        message_id: 5,
        date: 0,
        chat: { id: chatType === 'private' ? 333 : -600, type: chatType },
      },
    },
  } as unknown as Update;
}

describe('normalizeUpdate: Telegram Update -> channel-agnostic draft', () => {
  it('a DM text message normalizes to telegram_dm, addressed by the wake word', () => {
    const draft = normalizeUpdate(dmMessageUpdate('tinypay balance'), 'tinypay_bot');
    expect(draft).toMatchObject({
      channel: 'telegram_dm',
      chatRef: '111',
      text: 'tinypay balance',
      mentionsBot: true,
      isGroup: false,
      telegramUserId: '111',
    });
  });

  it('a DM text message with no wake word still normalizes (addressing is InvocationGate/adapter policy, not a normalization failure)', () => {
    const draft = normalizeUpdate(dmMessageUpdate('hello there'), 'tinypay_bot');
    expect(draft?.mentionsBot).toBe(false);
    expect(draft?.channel).toBe('telegram_dm');
  });

  it('a group text message without the wake word or an @mention normalizes with mentionsBot: false', () => {
    const draft = normalizeUpdate(groupMessageUpdate('anyone up for lunch?'), 'tinypay_bot');
    expect(draft?.isGroup).toBe(true);
    expect(draft?.mentionsBot).toBe(false);
    expect(draft?.groupId).toBe('-500');
  });

  it('a group message addressed via the wake word normalizes with mentionsBot: true', () => {
    const draft = normalizeUpdate(groupMessageUpdate('tinypay: balance'), 'tinypay_bot');
    expect(draft?.mentionsBot).toBe(true);
    expect(draft?.groupId).toBe('-500');
  });

  it('a group message addressed via an @mention entity normalizes with mentionsBot: true', () => {
    const text = 'hey @tinypay_bot balance please';
    const entities = [{ type: 'mention', offset: 4, length: '@tinypay_bot'.length }] as Update['message']['entities'];
    const draft = normalizeUpdate(groupMessageUpdate(text, { entities }), 'tinypay_bot');
    expect(draft?.mentionsBot).toBe(true);
  });

  it('a callback_query normalizes with the decoded structured payload and the tapping user\'s id', () => {
    const draft = normalizeUpdate(callbackQueryUpdate(encodeCallback('transfer', 'await_confirm', 'yes')), 'tinypay_bot');
    expect(draft).toMatchObject({
      channel: 'telegram_dm',
      telegramUserId: '333',
      structured: { flow: 'transfer', step: 'await_confirm', value: 'yes' },
    });
  });

  it('a callback_query in a group normalizes as telegram_group with a groupId', () => {
    const draft = normalizeUpdate(callbackQueryUpdate(encodeCallback('transfer', 'await_confirm', 'yes'), 'group'), 'tinypay_bot');
    expect(draft?.channel).toBe('telegram_group');
    expect(draft?.groupId).toBe('-600');
  });

  it('an update with neither a message nor a callback_query normalizes to null (ignored)', () => {
    expect(normalizeUpdate({ update_id: 9 } as Update, 'tinypay_bot')).toBeNull();
  });

  it('a message with no text (e.g. a contact share) normalizes to null — the adapter handles contacts separately', () => {
    const update = {
      update_id: 4,
      message: { message_id: 4, date: 0, chat: { id: 1, type: 'private' }, from: { id: 1, is_bot: false, first_name: 'A' } },
    } as unknown as Update;
    expect(normalizeUpdate(update, 'tinypay_bot')).toBeNull();
  });
});

describe('callback-codec: encode/decode round trip', () => {
  it('round-trips flow/step/value', () => {
    const data = encodeCallback('transfer', 'await_confirm', 'yes');
    expect(decodeCallback(data)).toEqual({ flow: 'transfer', step: 'await_confirm', value: 'yes' });
  });

  it('stays within Telegram\'s 64-byte callback_data limit for realistic values', () => {
    const data = encodeCallback('transfer', 'awaiting_web_confirm', 'cancel');
    expect(Buffer.byteLength(data, 'utf8')).toBeLessThanOrEqual(64);
  });

  it('throws when encoding would exceed the 64-byte limit', () => {
    expect(() => encodeCallback('x'.repeat(40), 'y'.repeat(20), 'z'.repeat(20))).toThrow(/64-byte/);
  });

  it('decode returns null for malformed data (wrong segment count, or an empty segment)', () => {
    expect(decodeCallback('not-a-triple')).toBeNull();
    expect(decodeCallback('a:b:')).toBeNull();
    expect(decodeCallback('a::c')).toBeNull();
    expect(decodeCallback('a:b:c:d')).toBeNull();
  });
});
