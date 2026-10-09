import { computeFundFeeMinor } from '../../src/shared/utils/fees.js';

describe('computeFundFeeMinor: 1.5% funding fee, exact to the kobo', () => {
  it('₦500 (50000 kobo) -> ₦7.50 fee', () => {
    expect(computeFundFeeMinor(500_00n)).toBe(750n);
  });

  it('₦1000 -> ₦15.00 fee', () => {
    expect(computeFundFeeMinor(1000_00n)).toBe(1500n);
  });

  it('rounds an exact half up, not down (truncation would give 1n)', () => {
    // 100 * 150 / 10_000 = 1.5kobo exactly.
    expect(computeFundFeeMinor(100n)).toBe(2n);
  });

  it('zero in, zero out', () => {
    expect(computeFundFeeMinor(0n)).toBe(0n);
  });
});
