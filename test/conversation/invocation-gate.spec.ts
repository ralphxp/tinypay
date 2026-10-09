import { InvocationGate, scrubPin } from '../../src/modules/conversation/invocation.gate.js';

describe('InvocationGate', () => {
  const gate = new InvocationGate();

  describe('DM', () => {
    it('always addressed, wake-word or not — a 1:1 DM has no ambiguity about who a message is for', () => {
      const result = gate.check({ surface: 'telegram_dm', text: 'balance' });
      expect(result).toEqual({ addressed: true, utterance: 'balance' });
    });

    it('a wake-word prefix (case-insensitive) is still recognized and stripped if someone types it out of habit', () => {
      const result = gate.check({ surface: 'telegram_dm', text: 'TinyPay balance' });
      expect(result).toEqual({ addressed: true, utterance: 'balance' });
    });

    it('mid-flow free text needs no wake-word at all', () => {
      const result = gate.check({ surface: 'telegram_dm', text: '5000' });
      expect(result).toEqual({ addressed: true, utterance: '5000' });
    });

    it('a wake-word prefix included out of habit mid-flow is still stripped — regression for a real bug where "tinypay 500" reached a step as literal text and failed to parse as an amount', () => {
      const result = gate.check({ surface: 'telegram_dm', text: 'tinypay 500' });
      expect(result).toEqual({ addressed: true, utterance: '500' });
    });
  });

  describe('group', () => {
    it('requires the wake-word or an @mention every turn — a group has other participants, so silence can\'t be read as "still talking to the bot"', () => {
      const result = gate.check({ surface: 'telegram_group', text: 'balance' });
      expect(result.addressed).toBe(false);
    });

    it('the wake-word addresses and is stripped', () => {
      const result = gate.check({ surface: 'telegram_group', text: 'tinypay 5000' });
      expect(result).toEqual({ addressed: true, utterance: '5000' });
    });

    it('an @mention addresses without the wake-word', () => {
      const result = gate.check({ surface: 'telegram_group', text: '@tinypay balance' });
      expect(result).toEqual({ addressed: true, utterance: 'balance' });
    });
  });
});

describe('scrubPin', () => {
  it('removes an inline 4-digit PIN token', () => {
    expect(scrubPin('my pin is 1234 confirm')).toBe('my pin is confirm');
  });

  it('leaves text with no PIN-shaped token untouched', () => {
    expect(scrubPin('send 50k to gtb')).toBe('send 50k to gtb');
  });

  it('is idempotent', () => {
    const once = scrubPin('pin 1234 here');
    expect(scrubPin(once)).toBe(once);
  });
});
