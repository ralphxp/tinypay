import type { Network } from '@prisma/client';

export const BILLER_PORT = Symbol('BILLER_PORT');

export interface BuyAirtimeInput {
  network: Network;
  phone: string;
  amountMinor: bigint;
  /** Internal ref (ULID) — sent as the biller's own idempotency/request id, never regenerated on retry. */
  reference: string;
}

export interface BuyDataInput {
  network: Network;
  phone: string;
  /** The plan `id` from listDataPlans() — data bundles are sold as fixed plan codes, not an amount. */
  planCode: string;
  reference: string;
}

export interface BillerPurchaseResult {
  /** The biller's own order/transaction id — recorded on WalletTransaction.providerRef. */
  providerRef: string;
  /** 'pending' means the biller itself hasn't resolved it yet (still processing with
   * the network) — not a failure. Callers must not refund on 'pending'. */
  status: 'success' | 'pending' | 'failed';
}

export interface DataPlan {
  /** Sent verbatim as `plan` on buyData() — Bigisub's own numeric plan id. */
  planCode: string;
  label: string;
  priceMinor: bigint;
}

/**
 * The one seam core code depends on for airtime/data purchases — no module
 * outside modules/payments/bigisub may call Bigisub's HTTP API directly.
 * Mirrors the ledger-before-provider discipline: WalletService.reserveDebit
 * always runs before this is ever called (see flows/airtime.flow.ts,
 * flows/data.flow.ts).
 */
export interface BillerPort {
  buyAirtime(input: BuyAirtimeInput): Promise<BillerPurchaseResult>;
  buyData(input: BuyDataInput): Promise<BillerPurchaseResult>;
  listDataPlans(network: Network): Promise<DataPlan[]>;
}

/** Test/local-dev stand-in — always succeeds, never makes a network call. */
export class StubBillerProvider implements BillerPort {
  async buyAirtime(input: BuyAirtimeInput): Promise<BillerPurchaseResult> {
    return { providerRef: `stub-airtime:${input.reference}`, status: 'success' };
  }

  async buyData(input: BuyDataInput): Promise<BillerPurchaseResult> {
    return { providerRef: `stub-data:${input.reference}`, status: 'success' };
  }

  async listDataPlans(): Promise<DataPlan[]> {
    return [
      { planCode: 'stub-1gb', label: '1GB — 30 days', priceMinor: 300_00n },
      { planCode: 'stub-2gb', label: '2GB — 30 days', priceMinor: 600_00n },
    ];
  }
}
