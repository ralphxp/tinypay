import { Injectable } from '@nestjs/common';
import type { Network } from '@prisma/client';
import { ConfigService } from '../../../config/config.service.js';
import { toLocalPhone } from '../../../shared/utils/phone.js';
import { BigisubClient } from './bigisub.client.js';
import { BIGISUB_ENDPOINTS, BIGISUB_NETWORK_ID } from './bigisub.endpoints.js';
import type { BillerPort, BuyAirtimeInput, BuyDataInput, BillerPurchaseResult, DataPlan } from '../biller.port.js';

export interface BigisubWalletBalance {
  balanceMinor: bigint;
  pendingAmountMinor: bigint;
  username: string;
}

interface BigisubWalletBalanceResponse {
  balance: string | number;
  pending_amount: string | number;
  username: string;
}

/** CONFIRMED (dashboard docs + a live call). `submitted` is treated the same
 * as `processing` per the docs. */
type BigisubTransactionStatus =
  | 'successful'
  | 'completed'
  | 'processing'
  | 'submitted'
  | 'pending'
  | 'in_progress'
  | 'failed'
  | 'cancelled'
  | 'refunded'
  | 'partial';

interface BigisubPurchaseResponse {
  transaction_id: string;
  reference: string;
  status: BigisubTransactionStatus;
}

interface BigisubDataPlanResponse {
  id: number;
  network: number;
  network_name: string;
  plantype: string;
  /** CONFIRMED via a live call: a bare number (e.g. 1.5), not "1.5GB" as the
   * dashboard's own doc example showed — the unit is the separate plan_volume field. */
  size: number;
  plan_volume: string;
  validity: string;
  /** The price actually charged — already tiered to this account's user_type (reseller/corporate/regular). */
  amount: number;
  plan_disabled: boolean;
}

const SUCCESS_STATUSES = new Set<BigisubTransactionStatus>(['successful', 'completed']);
const PENDING_STATUSES = new Set<BigisubTransactionStatus>(['processing', 'submitted', 'pending', 'in_progress']);

function mapStatus(status: BigisubTransactionStatus): 'success' | 'pending' | 'failed' {
  if (SUCCESS_STATUSES.has(status)) return 'success';
  if (PENDING_STATUSES.has(status)) return 'pending';
  return 'failed';
}

/**
 * CONFIRMED against the real dashboard docs + live calls: base path
 * `/api/v2/...`, envelope `{success, message, data}` (BigisubClient),
 * `Authorization: Token <key>`, numeric network ids (BIGISUB_NETWORK_ID),
 * `phone_number` in local 0-prefixed form, every purchase needs the
 * account's own 4-digit transaction PIN (BIGISUB_TRANSACTION_PIN), and a
 * purchase can come back `pending` (processing with the network) rather
 * than an immediate success/fail — see mapStatus. A `pending` result must
 * never be refunded (flows/airtime.flow.ts, flows/data.flow.ts leave the
 * WalletTransaction at its initial 'pending' status and tell the user to
 * check back — there's no webhook, only the requery endpoint below, and
 * nothing polls it automatically yet).
 *
 * The data-purchase request body (network/phone_number/plan/pin) is
 * inferred by analogy with the confirmed airtime-purchase shape — the docs
 * didn't show an explicit example for it, unlike airtime's.
 */
@Injectable()
export class BigisubProvider implements BillerPort {
  constructor(
    private readonly client: BigisubClient,
    private readonly config: ConfigService,
  ) {}

  async getWalletBalance(): Promise<BigisubWalletBalance> {
    const data = await this.client.request<BigisubWalletBalanceResponse>('GET', BIGISUB_ENDPOINTS.wallet.balance);
    return {
      balanceMinor: BigInt(Math.round(Number(data.balance) * 100)),
      pendingAmountMinor: BigInt(Math.round(Number(data.pending_amount) * 100)),
      username: data.username,
    };
  }

  async buyAirtime(input: BuyAirtimeInput): Promise<BillerPurchaseResult> {
    const data = await this.client.request<BigisubPurchaseResponse>('POST', BIGISUB_ENDPOINTS.vtu.airtimePurchase, {
      network: BIGISUB_NETWORK_ID[input.network],
      phone_number: toLocalPhone(input.phone),
      amount: (Number(input.amountMinor) / 100).toString(),
      airtime_type: 'vtu',
      pin: this.config.get('BIGISUB_TRANSACTION_PIN'),
    });
    return { providerRef: data.transaction_id, status: mapStatus(data.status) };
  }

  /**
   * Defaults to `plantype=SME` — a live check against the real endpoint
   * showed MTN alone returns 66 plans across 4 plantypes (GIFTING, SME,
   * DataTransfer, CGIFTING); SME is the smallest, standard reseller tier
   * (13 plans for MTN) and keeps the picker to a reasonable number of
   * choices. A future slice could let the user pick a plantype instead.
   */
  async listDataPlans(network: Network): Promise<DataPlan[]> {
    const networkId = BIGISUB_NETWORK_ID[network];
    const data = await this.client.request<BigisubDataPlanResponse[]>(
      'GET',
      `${BIGISUB_ENDPOINTS.vtu.dataPlans}?network=${networkId}&plantype=SME`,
    );
    return data
      .filter((plan) => !plan.plan_disabled)
      .map((plan) => ({
        planCode: String(plan.id),
        label: `${plan.size}${plan.plan_volume} — ${plan.validity}`,
        priceMinor: BigInt(Math.round(plan.amount * 100)),
      }));
  }

  async buyData(input: BuyDataInput): Promise<BillerPurchaseResult> {
    const data = await this.client.request<BigisubPurchaseResponse>('POST', BIGISUB_ENDPOINTS.vtu.dataPurchase, {
      network: BIGISUB_NETWORK_ID[input.network],
      phone_number: toLocalPhone(input.phone),
      plan: input.planCode,
      pin: this.config.get('BIGISUB_TRANSACTION_PIN'),
    });
    return { providerRef: data.transaction_id, status: mapStatus(data.status) };
  }

  /** Not wired into any flow yet — available for a future "check pending transaction" command. */
  async requeryTransaction(providerRef: string): Promise<BillerPurchaseResult> {
    const data = await this.client.request<BigisubPurchaseResponse>(
      'POST',
      BIGISUB_ENDPOINTS.transactions.requery(providerRef),
    );
    return { providerRef: data.transaction_id, status: mapStatus(data.status) };
  }
}
