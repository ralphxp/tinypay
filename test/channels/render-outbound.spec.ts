import { renderForTelegram } from '../../src/modules/channels/telegram/render-outbound.js';

describe('renderForTelegram: OutboundMessage -> Telegram send payload', () => {
  it('a plain string choice is both the button label and the tapped value', () => {
    const payload = renderForTelegram({ text: 'Confirm?', choices: ['yes', 'cancel'] }, { flow: 'fund', step: 'await_confirm' });

    expect(payload.reply_markup?.inline_keyboard).toEqual([
      [
        { text: 'yes', callback_data: 'fund:await_confirm:yes' },
        { text: 'cancel', callback_data: 'fund:await_confirm:cancel' },
      ],
    ]);
  });

  it('a {label, value} choice displays the long label but encodes only the short value — ' +
    'proves the data-plan picker never blows Telegram\'s 64-byte callback_data cap', () => {
    const longLabel = '1.5GB (SME) — 30 days [ALL SOCIAL MEDIA APPS INCLUDED] — ₦1,435.00';
    const payload = renderForTelegram(
      { text: 'Pick a plan:', choices: [{ label: longLabel, value: '298' }] },
      { flow: 'data', step: 'await_plan' },
    );

    const button = payload.reply_markup!.inline_keyboard[0]![0]!;
    expect(button.text).toBe(longLabel); // the user still sees the full, readable label
    expect(button.callback_data).toBe('data:await_plan:298'); // but the wire value stays short
    expect(Buffer.byteLength(button.callback_data, 'utf8')).toBeLessThanOrEqual(64);
  });

  it('with no callbackContext (a notification, not an active flow step), the choice itself is the raw callback_data', () => {
    const payload = renderForTelegram({ text: 'hi', choices: [{ label: 'Long label', value: 'short' }] });

    expect(payload.reply_markup?.inline_keyboard).toEqual([[{ text: 'Long label', callback_data: 'short' }]]);
  });

  it('no choices means no reply_markup at all', () => {
    const payload = renderForTelegram({ text: 'just text' });
    expect(payload.reply_markup).toBeUndefined();
  });
});
