import { parseGrammar } from '../../src/modules/nlu/grammar.js';
import { isLikelyPhoneNumber, normalizePhone, parseAmountToMinor } from '../../src/modules/nlu/normalizer.js';

describe('grammar', () => {
  it.each(['balance', 'bal', 'my balance', 'Check Balance'])('parses "%s" as balance', (text) => {
    expect(parseGrammar(text)).toEqual({ verb: 'balance' });
  });

  it.each(['fund', 'deposit', 'add money', 'top up', 'topup my wallet'])(
    'parses "%s" as fund',
    (text) => {
      expect(parseGrammar(text)).toEqual({ verb: 'fund' });
    },
  );

  it('parses a transfer to a phone number', () => {
    expect(parseGrammar('transfer 5000 to +2348012345678')).toEqual({
      verb: 'transfer',
      amountText: '5000',
      recipientText: '+2348012345678',
      bankText: undefined,
    });
  });

  it('parses a transfer to a bank account with bank name', () => {
    expect(parseGrammar('send 5,000 to 0123456789 GTBank')).toEqual({
      verb: 'transfer',
      amountText: '5,000',
      recipientText: '0123456789',
      bankText: 'GTBank',
    });
  });

  it('parses a withdrawal', () => {
    expect(parseGrammar('withdraw 10000 to 0123456789 access')).toEqual({
      verb: 'withdraw',
      amountText: '10000',
      recipientText: '0123456789',
      bankText: 'access',
    });
  });

  it('returns null for unrecognized text', () => {
    expect(parseGrammar('how far my guy')).toBeNull();
  });
});

describe('normalizer', () => {
  describe('parseAmountToMinor', () => {
    it.each([
      ['5000', 500_000n],
      ['5,000', 500_000n],
      ['₦5000', 500_000n],
      ['5000 naira', 500_000n],
      ['5k', 500_000n],
      ['5000.50', 500_050n],
    ])('parses "%s" -> %s minor units', (text, expected) => {
      expect(parseAmountToMinor(text)).toBe(expected);
    });

    it.each(['0', '-100', 'abc', ''])('rejects "%s"', (text) => {
      expect(parseAmountToMinor(text)).toBeNull();
    });
  });

  describe('normalizePhone', () => {
    it.each([
      ['08012345678', '+2348012345678'],
      ['2348012345678', '+2348012345678'],
      ['+2348012345678', '+2348012345678'],
    ])('normalizes "%s" -> "%s"', (text, expected) => {
      expect(normalizePhone(text)).toBe(expected);
    });
  });

  describe('isLikelyPhoneNumber', () => {
    it.each(['08012345678', '2348012345678', '+2348012345678'])('accepts "%s"', (text) => {
      expect(isLikelyPhoneNumber(text)).toBe(true);
    });

    it.each(['0123456789'])('rejects a 10-digit NUBAN "%s"', (text) => {
      expect(isLikelyPhoneNumber(text)).toBe(false);
    });
  });
});
