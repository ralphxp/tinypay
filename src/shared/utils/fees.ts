/** 1.5% funding fee, in basis points (150 / 10,000) — kept as an integer so
 * the fee is computed in pure BigInt kobo arithmetic, never floating point
 * (see schema.prisma: "Money is always BIGINT minor units"). */
const FUND_FEE_BASIS_POINTS = 150n;
const BASIS_POINTS_DIVISOR = 10_000n;

/**
 * TinyPay passes Paystack's own processing cost on funding straight through
 * to the user instead of absorbing it: funding ₦500 still credits exactly
 * ₦500 to the wallet, but the Paystack checkout charges ₦500 + this fee.
 * Round-half-up (adding half the divisor before truncating integer
 * division) keeps the result exact to the kobo.
 */
export function computeFundFeeMinor(amountMinor: bigint): bigint {
  return (amountMinor * FUND_FEE_BASIS_POINTS + BASIS_POINTS_DIVISOR / 2n) / BASIS_POINTS_DIVISOR;
}
