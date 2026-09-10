import { contribution, disbursement, funding, withdrawal } from './ledger.postings.js';
import type { AccountRef } from '../../shared/types/account.js';

const wallet: AccountRef = { ownerType: 'user', ownerId: 'user_1', kind: 'wallet' };
const settlement: AccountRef = { ownerType: 'system', ownerId: 'psp_settlement_ngn', kind: 'psp_settlement' };
const fees: AccountRef = { ownerType: 'system', ownerId: 'fees_ngn', kind: 'fees' };
const pool: AccountRef = { ownerType: 'group', ownerId: 'group_1', kind: 'pool' };

function sum(legs: { amountMinor: bigint }[]): bigint {
  return legs.reduce((total, leg) => total + leg.amountMinor, 0n);
}

describe('ledger.postings builders', () => {
  it('funding sums to zero', () => {
    const legs = funding(wallet, settlement, 5000n);
    expect(sum(legs)).toBe(0n);
    expect(legs).toEqual([
      { accountRef: wallet, amountMinor: 5000n },
      { accountRef: settlement, amountMinor: -5000n },
    ]);
  });

  it('withdrawal without a fee sums to zero', () => {
    const legs = withdrawal(wallet, settlement, 3000n);
    expect(sum(legs)).toBe(0n);
    expect(legs).toEqual([
      { accountRef: wallet, amountMinor: -3000n },
      { accountRef: settlement, amountMinor: 3000n },
    ]);
  });

  it('withdrawal with a fee sums to zero and splits the fee out', () => {
    const legs = withdrawal(wallet, settlement, 3000n, 100n, fees);
    expect(sum(legs)).toBe(0n);
    expect(legs).toEqual([
      { accountRef: wallet, amountMinor: -3000n },
      { accountRef: settlement, amountMinor: 2900n },
      { accountRef: fees, amountMinor: 100n },
    ]);
  });

  it('withdrawal throws if a fee is given without a fees account', () => {
    expect(() => withdrawal(wallet, settlement, 3000n, 100n)).toThrow(
      /feesAcct is required/,
    );
  });

  it('contribution sums to zero and tags both legs', () => {
    const tags = { groupId: 'group_1', roundId: 'round_1', memberId: 'user_1' };
    const legs = contribution(wallet, pool, 1000n, tags);
    expect(sum(legs)).toBe(0n);
    expect(legs).toEqual([
      { accountRef: wallet, amountMinor: -1000n, ...tags },
      { accountRef: pool, amountMinor: 1000n, ...tags },
    ]);
  });

  it('disbursement sums to zero and tags only the pool leg', () => {
    const legs = disbursement(pool, settlement, 2000n, { groupId: 'group_1' });
    expect(sum(legs)).toBe(0n);
    expect(legs).toEqual([
      { accountRef: pool, amountMinor: -2000n, groupId: 'group_1' },
      { accountRef: settlement, amountMinor: 2000n },
    ]);
  });
});
