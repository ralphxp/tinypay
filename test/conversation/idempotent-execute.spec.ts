import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '../../src/config/config.module.js';
import { RedisModule } from '../../src/infra/redis/redis.module.js';
import { ConversationService } from '../../src/modules/conversation/conversation.service.js';
import { StateStore } from '../../src/modules/conversation/state.store.js';
import { FlowRegistry } from '../../src/modules/conversation/flow.registry.js';
import {
  RECIPIENT_RESOLVER_PORT,
  StubRecipientResolver,
} from '../../src/modules/conversation/ports/recipient-resolver.port.js';
import { EXECUTOR_PORT, StubExecutor } from '../../src/modules/conversation/ports/executor.port.js';
import type { ChannelName, Session } from '../../src/modules/conversation/types.js';

// The real guarantee against double-executing a transfer lives in the
// ledger's externalRef dedupe (a later slice). The FSM layer must not
// assume that — or this stub — will silently absorb a duplicate on its
// own: the `executing` step itself must check getStatus() before ever
// calling execute(). This is what's under test here, both at the flow
// definition level (directly) and through a realistic re-entry via advance().
describe('Conversation FSM: idempotent execute', () => {
  let moduleRef: TestingModule;
  let conversation: ConversationService;
  let stateStore: StateStore;
  let registry: FlowRegistry;
  let executor: StubExecutor;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, RedisModule],
      providers: [
        ConversationService,
        StateStore,
        FlowRegistry,
        { provide: RECIPIENT_RESOLVER_PORT, useClass: StubRecipientResolver },
        { provide: EXECUTOR_PORT, useClass: StubExecutor },
      ],
    }).compile();
    conversation = moduleRef.get(ConversationService);
    stateStore = moduleRef.get(StateStore);
    registry = moduleRef.get(FlowRegistry);
    executor = moduleRef.get(EXECUTOR_PORT);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('the executing step checks status before executing: landing there twice with the same ref runs execute() once', async () => {
    const ref = `tinypay:${randomUUID()}`;
    const session: Session = {
      ...stateStore.fresh(),
      flow: 'transfer',
      step: 'executing',
      slots: { idempotencyRef: ref, amountMinor: '500', recipientAccountRef: 'stub-account:0801' },
    };

    const executingStep = registry.get('transfer').steps.executing!;

    const first = await executingStep.next(session);
    const second = await executingStep.next(session);

    expect(first).toBe('done');
    expect(second).toBe('done');
    expect(executor.calls).toEqual([ref]);
    expect(executor.calls).toHaveLength(1);
  });

  it('end-to-end: a genuine duplicate turn at await_pin (same idempotencyRef) does not re-execute', async () => {
    const userId = randomUUID();
    const channel: ChannelName = 'telegram_dm';
    const base = { userId, channel };
    const key = `fsm:${userId}:${channel}`;

    await conversation.advance({ ...base, kind: 'start_transfer' });
    await conversation.advance({ ...base, kind: 'input', payload: { recipientQuery: '0802' } });
    await conversation.advance({ ...base, kind: 'input', payload: { amountMinor: '900' } });
    await conversation.advance({ ...base, kind: 'input', payload: { confirmed: true } });

    const parked = await stateStore.load(key);
    const ref = parked?.slots.idempotencyRef as string;
    expect(ref).toBeDefined();

    const first = await conversation.advance({ ...base, kind: 'input', payload: { pin: '1234' } });
    expect(first?.text).toContain('Status: executed');

    // Force the session back to await_pin with the *same* idempotencyRef —
    // standing in for a retried/redelivered PIN turn after a crash between
    // execute() and the session advancing to done.
    const finished = await stateStore.load(key);
    const finishedVersion = finished?.v ?? 0;
    await stateStore.save(
      key,
      { ...stateStore.fresh(), flow: 'transfer', step: 'await_pin', slots: { idempotencyRef: ref } },
      finishedVersion,
    );

    const second = await conversation.advance({ ...base, kind: 'input', payload: { pin: '1234' } });
    expect(second?.text).toContain('Status: executed');

    expect(executor.calls.filter((r) => r === ref)).toHaveLength(1);
  });
});
