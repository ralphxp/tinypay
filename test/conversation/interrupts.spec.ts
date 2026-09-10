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

describe('Conversation FSM: global interrupts', () => {
  let moduleRef: TestingModule;
  let conversation: ConversationService;
  let stateStore: StateStore;

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
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('cancel escapes to idle and clears flow state, from mid-flow', async () => {
    const userId = randomUUID();
    const channel: ChannelName = 'telegram_dm';
    const base = { userId, channel };

    await conversation.advance({ ...base, kind: 'start_transfer' });
    await conversation.advance({ ...base, kind: 'input', payload: { recipientQuery: '0801' } });
    await conversation.advance({ ...base, kind: 'input', payload: { amountMinor: '500' } });

    const reply = await conversation.advance({ ...base, kind: 'cancel' });
    expect(reply?.text).toBe('Cancelled.');

    const session = await stateStore.load(`fsm:${userId}:${channel}`);
    expect(session?.flow).toBeNull();
    expect(session?.step).toBeNull();
    expect(session?.slots).toEqual({});
  });

  it('cancel escapes from every step of the flow, not just one', async () => {
    const steps = ['await_recipient', 'await_amount', 'await_confirm', 'await_pin'] as const;

    for (const stopAt of steps) {
      const userId = randomUUID();
      const channel: ChannelName = 'telegram_dm';
      const base = { userId, channel };

      await conversation.advance({ ...base, kind: 'start_transfer' });
      if (stopAt !== 'await_recipient') {
        await conversation.advance({ ...base, kind: 'input', payload: { recipientQuery: '0801' } });
      }
      if (stopAt === 'await_confirm' || stopAt === 'await_pin') {
        await conversation.advance({ ...base, kind: 'input', payload: { amountMinor: '500' } });
      }
      if (stopAt === 'await_pin') {
        await conversation.advance({ ...base, kind: 'input', payload: { confirmed: true } });
      }

      const reply = await conversation.advance({ ...base, kind: 'cancel' });
      expect(reply?.text).toBe('Cancelled.');
      const session = await stateStore.load(`fsm:${userId}:${channel}`);
      expect(session?.flow).toBeNull();
    }
  });

  it('cancel on an idle session is a graceful no-op, not an error', async () => {
    const userId = randomUUID();
    const channel: ChannelName = 'telegram_dm';
    const reply = await conversation.advance({ userId, channel, kind: 'cancel' });
    expect(reply?.text).toBe('Nothing in progress to cancel.');
  });

  it('back returns to the prior step, preserving previously filled slots', async () => {
    const userId = randomUUID();
    const channel: ChannelName = 'telegram_dm';
    const base = { userId, channel };

    await conversation.advance({ ...base, kind: 'start_transfer' });
    await conversation.advance({ ...base, kind: 'input', payload: { recipientQuery: '0801' } });
    await conversation.advance({ ...base, kind: 'input', payload: { amountMinor: '500' } });
    // Now at await_confirm.

    const back = await conversation.advance({ ...base, kind: 'back' });
    expect(back?.text).toContain('How much would you like to send');

    const session = await stateStore.load(`fsm:${userId}:${channel}`);
    expect(session?.step).toBe('await_amount');
    expect(session?.slots.recipientLabel).toBe('Stub Recipient (0801)'); // not lost by going back

    // Re-answering moves forward again.
    const forward = await conversation.advance({ ...base, kind: 'input', payload: { amountMinor: '750' } });
    expect(forward?.text).toContain('Send 750 minor units');
  });

  it('back on an idle session (or with no history) is a graceful no-op', async () => {
    const userId = randomUUID();
    const channel: ChannelName = 'telegram_dm';
    const reply = await conversation.advance({ userId, channel, kind: 'back' });
    expect(reply?.text).toBe("There's nothing to go back to.");
  });

  it('help never mutates session state', async () => {
    const userId = randomUUID();
    const channel: ChannelName = 'telegram_dm';
    const base = { userId, channel };

    await conversation.advance({ ...base, kind: 'start_transfer' });
    const before = await stateStore.load(`fsm:${userId}:${channel}`);

    const reply = await conversation.advance({ ...base, kind: 'help' });
    expect(reply?.text).toContain('transfer');

    const after = await stateStore.load(`fsm:${userId}:${channel}`);
    expect(after).toEqual(before);
  });

  it('menu escapes an active flow to idle', async () => {
    const userId = randomUUID();
    const channel: ChannelName = 'telegram_dm';
    const base = { userId, channel };

    await conversation.advance({ ...base, kind: 'start_transfer' });
    const reply = await conversation.advance({ ...base, kind: 'menu' });
    expect(reply?.text).toContain('transfer');

    const session = await stateStore.load(`fsm:${userId}:${channel}`);
    expect(session?.flow).toBeNull();
  });
});
