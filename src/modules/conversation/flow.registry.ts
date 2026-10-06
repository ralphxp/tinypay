import { Inject, Injectable } from '@nestjs/common';
import { createFundFlow } from './flows/fund.flow.js';
import { createAirtimeFlow } from './flows/airtime.flow.js';
import { createDataFlow } from './flows/data.flow.js';
import { WalletService } from '../wallet/wallet.service.js';
import { PaystackProvider } from '../payments/paystack/paystack.provider.js';
import { BILLER_PORT, type BillerPort } from '../payments/biller.port.js';
import { NOTIFICATION_SINK, type NotificationSink } from '../notifications/notification.port.js';
import type { FlowDef } from './types.js';

export type FlowName = 'fund' | 'airtime' | 'data';

/** InboundEvent.kind values that start a fresh flow when the session is idle. */
export const FLOW_START_KINDS: Record<string, FlowName> = {
  start_fund: 'fund',
  start_airtime: 'airtime',
  start_data: 'data',
};

@Injectable()
export class FlowRegistry {
  private readonly flows: Record<FlowName, FlowDef>;

  constructor(
    wallet: WalletService,
    paystack: PaystackProvider,
    @Inject(BILLER_PORT) biller: BillerPort,
    @Inject(NOTIFICATION_SINK) notifications: NotificationSink,
  ) {
    this.flows = {
      fund: createFundFlow({ wallet, paystack }),
      airtime: createAirtimeFlow({ wallet, biller, notifications }),
      data: createDataFlow({ wallet, biller, notifications }),
    };
  }

  get(name: string): FlowDef {
    const flow = this.flows[name as FlowName];
    if (!flow) {
      throw new Error(`Unknown flow: ${name}`);
    }
    return flow;
  }
}
