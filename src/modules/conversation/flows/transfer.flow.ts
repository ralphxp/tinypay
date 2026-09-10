import { ulid } from 'ulid';
import { StepError } from '../../../common/errors/domain-errors.js';
import type { RecipientResolverPort } from '../ports/recipient-resolver.port.js';
import type { ExecutorPort } from '../ports/executor.port.js';
import type { FlowDef, InboundEvent, Session } from '../types.js';

export interface TransferFlowDeps {
  recipientResolver: RecipientResolverPort;
  executor: ExecutorPort;
}

function str(payload: InboundEvent['payload'], key: string): string | undefined {
  const value = payload?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * transfer: await_recipient -> resolve_recipient -> await_amount ->
 * await_confirm -> await_pin -> executing -> done.
 *
 * resolve_recipient and executing are `auto: true` — they call the injected
 * ports and chain straight to the next step within the same turn. Money is
 * fully stubbed here (RecipientResolverPort/ExecutorPort): no Paystack, no
 * ledger call, so losing this flow's Redis session loses nothing financial.
 */
export function createTransferFlow(deps: TransferFlowDeps): FlowDef {
  return {
    entry: 'await_recipient',
    terminal: ['done'],
    steps: {
      await_recipient: {
        prompt: () => ({ text: 'Who would you like to send money to?' }),
        validate: (evt) => {
          const recipientQuery = str(evt.payload, 'recipientQuery');
          if (!recipientQuery) {
            throw new StepError('Tell me who to send to — a phone number or account.');
          }
          return { slots: { recipientQuery } };
        },
        next: () => 'resolve_recipient',
      },

      resolve_recipient: {
        auto: true,
        prompt: () => ({ text: 'Looking that up…' }),
        validate: () => ({}),
        next: async (session) => {
          const query = session.slots.recipientQuery as string;
          const resolved = await deps.recipientResolver.resolve(query);
          session.slots.recipientLabel = resolved.label;
          session.slots.recipientAccountRef = resolved.accountRef;
          return 'await_amount';
        },
      },

      await_amount: {
        prompt: (session) => ({ text: `How much would you like to send to ${session.slots.recipientLabel}?` }),
        validate: (evt) => {
          const raw = str(evt.payload, 'amountMinor');
          const amountMinor = raw ? BigInt(raw) : undefined;
          if (amountMinor === undefined || amountMinor <= 0n) {
            throw new StepError('Enter a valid amount greater than zero.');
          }
          return { slots: { amountMinor: amountMinor.toString() } };
        },
        next: () => 'await_confirm',
      },

      await_confirm: {
        prompt: (session) => ({
          text: `Send ${session.slots.amountMinor} minor units to ${session.slots.recipientLabel}? Reply yes to confirm.`,
          choices: ['yes', 'cancel'],
        }),
        validate: (evt) => {
          if (evt.payload?.confirmed !== true) {
            throw new StepError("Reply 'yes' to confirm, or 'cancel' to abort.");
          }
          return {};
        },
        next: (session) => {
          // Minted on entry to await_pin, reused on any executing retry —
          // idempotent-mint guard so re-confirming (e.g. after `back`) never
          // mints a second ref for the same intended transfer.
          session.slots.idempotencyRef ??= `tinypay:${ulid()}`;
          return 'await_pin';
        },
      },

      await_pin: {
        maxAttempts: 3,
        prompt: () => ({ text: 'Enter your PIN to authorize this transfer.' }),
        validate: (evt) => {
          const pin = str(evt.payload, 'pin');
          if (!pin) {
            throw new StepError('Enter your 4-digit PIN.');
          }
          return { slots: { pinEntered: true } };
        },
        next: () => 'executing',
      },

      executing: {
        auto: true,
        prompt: () => ({ text: 'Processing…' }),
        validate: () => ({}),
        next: async (session: Session) => {
          const ref = session.slots.idempotencyRef as string;
          const existing = await deps.executor.getStatus(ref);
          if (existing) {
            session.slots.executionStatus = existing.status;
            return 'done';
          }
          const amountMinor = BigInt(session.slots.amountMinor as string);
          const recipientAccountRef = session.slots.recipientAccountRef as string;
          const result = await deps.executor.execute(ref, amountMinor, recipientAccountRef);
          session.slots.executionStatus = result.status;
          return 'done';
        },
      },

      done: {
        prompt: (session) => ({
          text: `Sent ${session.slots.amountMinor} minor units to ${session.slots.recipientLabel}. Status: ${session.slots.executionStatus}.`,
        }),
        validate: () => ({}),
        next: () => 'done',
      },
    },
  };
}
