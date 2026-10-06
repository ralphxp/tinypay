import { parseGrammar } from '../../src/modules/nlu/grammar.js';

describe('parseGrammar: deterministic verb-first matching', () => {
  describe('fund', () => {
    it.each([
      ['fund', undefined],
      ['fund wallet', undefined],
      ['fund my wallet', undefined],
      ['fund 5000', '5000'],
      ['fund 5k', '5k'],
      ['deposit 2000', '2000'],
      ['top up 1000', '1000'],
      ['topup 1000', '1000'],
    ])('%s', (text, amountRaw) => {
      expect(parseGrammar(text)).toEqual({ intent: 'fund', entities: { amountRaw } });
    });
  });

  describe('balance / history', () => {
    it.each(['bal', 'balance', 'my balance', 'check balance'])('%s -> balance', (text) => {
      expect(parseGrammar(text)?.intent).toBe('balance');
    });
    it.each(['history', 'transactions', 'statement', 'my transactions'])('%s -> history', (text) => {
      expect(parseGrammar(text)?.intent).toBe('history');
    });
  });

  describe('airtime: "buy" and "send" are interchangeable, and both optional', () => {
    it.each(['airtime', 'buy airtime', 'send airtime', 'buy me airtime', 'send me airtime'])(
      '%s -> airtime, no entities',
      (text) => {
        expect(parseGrammar(text)).toEqual({
          intent: 'airtime',
          entities: { networkRaw: undefined, amountRaw: undefined, phoneRaw: undefined },
        });
      },
    );

    it('captures amount and a trailing network', () => {
      expect(parseGrammar('buy airtime 500 mtn')).toEqual({
        intent: 'airtime',
        entities: { networkRaw: 'mtn', amountRaw: '500', phoneRaw: undefined },
      });
    });

    it('captures a leading network before the verb', () => {
      expect(parseGrammar('mtn airtime 500')).toEqual({
        intent: 'airtime',
        entities: { networkRaw: 'mtn', amountRaw: '500', phoneRaw: undefined },
      });
    });

    it('a trailing phone (recipient) is captured whether or not "for"/"to" connects it', () => {
      expect(parseGrammar('send airtime for 08012345678')?.entities.phoneRaw).toBe('08012345678');
      expect(parseGrammar('buy airtime 500 mtn 08012345678')?.entities.phoneRaw).toBe('08012345678');
      expect(parseGrammar('mtn airtime 500 to 08012345678')?.entities.phoneRaw).toBe('08012345678');
    });
  });

  describe('data: same buy/send/me flexibility, and a plan has no amount at all', () => {
    it.each(['data', 'buy data', 'send data', 'buy me data', 'send me data'])('%s -> data', (text) => {
      expect(parseGrammar(text)?.intent).toBe('data');
    });

    it('captures network and a recipient phone', () => {
      expect(parseGrammar('mtn data for 08012345678')).toEqual({
        intent: 'data',
        entities: { networkRaw: 'mtn', phoneRaw: '08012345678' },
      });
    });
  });

  describe('no match', () => {
    it.each(['hello', 'what is this', ''])('%s -> null', (text) => {
      expect(parseGrammar(text)).toBeNull();
    });
  });
});
