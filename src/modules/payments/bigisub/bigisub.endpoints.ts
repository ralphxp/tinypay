/**
 * Every Bigisub endpoint documented so far (dashboard docs, 2026-10-06).
 * Electricity isn't wired into BillerPort (out of scope — airtime/data
 * only) but is kept here for reference since it's already confirmed.
 */
export const BIGISUB_ENDPOINTS = {
  wallet: {
    balance: '/api/v2/financial/wallet/balance/',
  },
  vtu: {
    airtimePurchase: '/api/v2/vtu/airtime/purchase/',
    dataPlans: '/api/v2/vtu/data/plans/',
    dataPurchase: '/api/v2/vtu/data/purchase/',
  },
  electricity: {
    providers: '/api/v2/bills/electricity/providers/',
    verify: '/api/v2/bills/electricity/verify/',
    pay: '/api/v2/bills/electricity/pay/',
  },
  transactions: {
    /** `{tranx_id}` — interpolate the transaction/order id into the path. */
    get: (tranxId: string) => `/api/v2/anubis/transactions/${encodeURIComponent(tranxId)}/`,
    requery: (tranxId: string) => `/api/v2/anubis/transactions/${encodeURIComponent(tranxId)}/requery/`,
  },
} as const;

/** Numeric network ids Bigisub's API expects on requests (not the string names its responses echo back). */
export const BIGISUB_NETWORK_ID: Record<string, number> = {
  mtn: 1,
  glo: 2,
  airtel: 3,
  nine_mobile: 4,
};
