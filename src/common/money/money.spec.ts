import { Money } from './money.js';

describe('Money', () => {
  it('adds and subtracts within the same currency', () => {
    const a = Money.of(1_000n, 'NGN');
    const b = Money.of(250n, 'NGN');

    expect(a.add(b).amountMinor).toBe(1_250n);
    expect(a.subtract(b).amountMinor).toBe(750n);
  });

  it('throws on cross-currency arithmetic', () => {
    const ngn = Money.of(1_000n, 'NGN');
    const usd = Money.of(1_000n, 'USD');

    expect(() => ngn.add(usd)).toThrow(/currency mismatch/i);
    expect(() => ngn.subtract(usd)).toThrow(/currency mismatch/i);
  });

  it('reports sign correctly', () => {
    expect(Money.of(0n, 'NGN').isZero()).toBe(true);
    expect(Money.of(1n, 'NGN').isPositive()).toBe(true);
    expect(Money.of(-1n, 'NGN').isNegative()).toBe(true);
  });

  it('negate flips the sign without mutating the original', () => {
    const original = Money.of(500n, 'NGN');
    const negated = original.negate();

    expect(negated.amountMinor).toBe(-500n);
    expect(original.amountMinor).toBe(500n);
  });

  it('compares amounts within the same currency', () => {
    const small = Money.of(100n, 'NGN');
    const large = Money.of(200n, 'NGN');

    expect(large.greaterThan(small)).toBe(true);
    expect(small.lessThan(large)).toBe(true);
    expect(small.equals(Money.of(100n, 'NGN'))).toBe(true);
  });
});
