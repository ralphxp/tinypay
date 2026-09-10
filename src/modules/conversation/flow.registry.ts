import { Inject, Injectable } from '@nestjs/common';
import { createTransferFlow } from './flows/transfer.flow.js';
import { RECIPIENT_RESOLVER_PORT, type RecipientResolverPort } from './ports/recipient-resolver.port.js';
import { EXECUTOR_PORT, type ExecutorPort } from './ports/executor.port.js';
import type { FlowDef } from './types.js';

export type FlowName = 'transfer';

/** InboundEvent.kind values that start a fresh flow when the session is idle. */
export const FLOW_START_KINDS: Record<string, FlowName> = {
  start_transfer: 'transfer',
};

@Injectable()
export class FlowRegistry {
  private readonly flows: Record<FlowName, FlowDef>;

  constructor(
    @Inject(RECIPIENT_RESOLVER_PORT) recipientResolver: RecipientResolverPort,
    @Inject(EXECUTOR_PORT) executor: ExecutorPort,
  ) {
    this.flows = {
      transfer: createTransferFlow({ recipientResolver, executor }),
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
