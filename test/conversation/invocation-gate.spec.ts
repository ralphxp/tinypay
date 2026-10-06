import { InvocationGate, scrubPin } from '../../src/modules/conversation/invocation.gate.js';

describe('InvocationGate', () => {
  const gate = new InvocationGate();

  describe('DM', () => {
    it('idle: requires the wake-word to be addressed', () => {
      const result = gate.check({ surface: 'telegram_dm', isActiveFlow: false, text: 'balance' });
      expect(result.addressed).toBe(false);
    });

    it('idle: wake-word (case-insensitive) addresses and is stripped', () => {
      const result = gate.check({ surface: 'telegram_dm', isActiveFlow: false, text: 'TinyPay balance' });
      expect(result).toEqual({ addressed: true, utterance: 'balance' });
    });

    it('mid-flow: does not require the wake-word', () => {
      const result = gate.check({ surface: 'telegram_dm', isActiveFlow: true, text: '5000' });
      expect(result).toEqual({ addressed: true, utterance: '5000' });
    });
  });

  describe('group', () => {
    it('idle: requires the wake-word or an @mention every turn', () => {
      const result = gate.check({ surface: 'telegram_group', isActiveFlow: false, text: 'balance' });
      expect(result.addressed).toBe(false);
    });

    it('mid-flow: STILL requires the wake-word or mention every turn', () => {
      const result = gate.check({ surface: 'telegram_group', isActiveFlow: true, text: '5000' });
      expect(result.addressed).toBe(false);
    });

    it('mid-flow with the wake-word: addressed', () => {
      const result = gate.check({ surface: 'telegram_group', isActiveFlow: true, text: 'tinypay 5000' });
      expect(result).toEqual({ addressed: true, utterance: '5000' });
    });

    it('an @mention addresses without the wake-word', () => {
      const result = gate.check({
        surface: 'telegram_group',
        isActiveFlow: false,
        text: '@tinypay balance',
      });
      expect(result).toEqual({ addressed: true, utterance: 'balance' });
    });
  });

  it('not-addressed + idle is ignored by the caller (addressed: false, no error)', () => {
    const result = gate.check({ surface: 'telegram_dm', isActiveFlow: false, text: 'random chatter' });
    expect(result.addressed).toBe(false);
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
