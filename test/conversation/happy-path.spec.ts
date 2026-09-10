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

describe('Conversation FSM: transfer happy path', () => {
  let moduleRef: TestingModule;
  let conversation: ConversationService;
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
    executor = moduleRef.get(EXECUTOR_PORT);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('walks await_recipient through done, accumulating slots across turns', async () => {
    const userId = randomUUID();
    const channel: ChannelName = 'telegram_dm';
    const base = { userId, channel };

    const t0 = await conversation.advance({ ...base, kind: 'start_transfer' });
    expect(t0?.text).toContain('Who would you like to send money to?');

    // resolve_recipient is `auto` — chains straight through to await_amount within this turn.
    const t1 = await conversation.advance({
      ...base,
      kind: 'input',
      payload: { recipientQuery: '08012345678' },
    });
    expect(t1?.text).toBe('How much would you like to send to Stub Recipient (08012345678)?');

    const t2 = await conversation.advance({ ...base, kind: 'input', payload: { amountMinor: '5000' } });
    expect(t2?.text).toContain('Send 5000 minor units to Stub Recipient (08012345678)');
    expect(t2?.choices).toEqual(['yes', 'cancel']);

    const t3 = await conversation.advance({ ...base, kind: 'input', payload: { confirmed: true } });
    expect(t3?.text).toBe('Enter your PIN to authorize this transfer.');

    // executing is `auto` — chains straight through to done within this turn.
    const t4 = await conversation.advance({ ...base, kind: 'input', payload: { pin: '1234' } });
    expect(t4?.text).toBe('Sent 5000 minor units to Stub Recipient (08012345678). Status: executed.');

    expect(executor.calls).toHaveLength(1);
  });

  it('re-prompts on invalid input without advancing the step', async () => {
    const userId = randomUUID();
    const channel: ChannelName = 'telegram_dm';
    const base = { userId, channel };

    await conversation.advance({ ...base, kind: 'start_transfer' });
    await conversation.advance({ ...base, kind: 'input', payload: { recipientQuery: '0801' } });

    const badAmount = await conversation.advance({ ...base, kind: 'input', payload: { amountMinor: '-5' } });
    expect(badAmount?.text).toBe('Enter a valid amount greater than zero.');

    // The step didn't advance — a valid amount now still lands on await_confirm.
    const goodAmount = await conversation.advance({ ...base, kind: 'input', payload: { amountMinor: '100' } });
    expect(goodAmount?.text).toContain('Send 100 minor units');
  });
});
