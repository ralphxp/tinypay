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
import type { ChannelName } from '../../src/modules/conversation/types.js';

describe('Conversation FSM: resume and expiry', () => {
  let moduleRef: TestingModule;
  let conversation: ConversationService;
  let stateStore: StateStore;
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
    executor = moduleRef.get(EXECUTOR_PORT);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('resumes at the right step after a save — a fresh load is not a fresh session', async () => {
    const userId = randomUUID();
    const channel: ChannelName = 'telegram_dm';
    const base = { userId, channel };
    const key = `fsm:${userId}:${channel}`;

    await conversation.advance({ ...base, kind: 'start_transfer' });
    await conversation.advance({ ...base, kind: 'input', payload: { recipientQuery: '0801' } });

    const loaded = await stateStore.load(key);
    expect(loaded?.flow).toBe('transfer');
    expect(loaded?.step).toBe('await_amount');
    expect(loaded?.slots.recipientLabel).toBe('Stub Recipient (0801)');

    // A brand-new turn against the same key resumes exactly where it left off.
    const reply = await conversation.advance({ ...base, kind: 'input', payload: { amountMinor: '500' } });
    expect(reply?.text).toContain('Send 500 minor units');
  });

  it('a deleted session (simulated expiry) mid-flow starts clean on the next event, and never reached the executor', async () => {
    const userId = randomUUID();
    const channel: ChannelName = 'telegram_dm';
    const base = { userId, channel };
    const key = `fsm:${userId}:${channel}`;

    await conversation.advance({ ...base, kind: 'start_transfer' });
    await conversation.advance({ ...base, kind: 'input', payload: { recipientQuery: '0801' } });
    await conversation.advance({ ...base, kind: 'input', payload: { amountMinor: '500' } });
    await conversation.advance({ ...base, kind: 'input', payload: { confirmed: true } });
    // Now sitting at await_pin, with an idempotencyRef minted but unused.

    const beforeExpiry = await stateStore.load(key);
    expect(beforeExpiry?.step).toBe('await_pin');
    expect(beforeExpiry?.slots.idempotencyRef).toBeDefined();

    // Simulate the session TTL expiring (or Redis losing the key outright).
    await stateStore.clear(key);
    expect(await stateStore.load(key)).toBeNull();

    // The next event has nothing to resume — it's treated as a fresh,
    // idle session, not as a continuation of await_pin.
    const reply = await conversation.advance({ ...base, kind: 'input', payload: { pin: '1234' } });
    expect(reply?.text).toBe("I didn't catch that. Say 'transfer' to send money.");

    const after = await stateStore.load(key);
    expect(after).toBeNull(); // idle fallback doesn't even write a session

    // Guiding principle #1: losing the session loses only the
    // conversation, never money — the executor was never invoked.
    expect(executor.calls).toHaveLength(0);
  });
});
