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

async function buildModule() {
  return Test.createTestingModule({
    imports: [ConfigModule, RedisModule],
    providers: [
      ConversationService,
      StateStore,
      FlowRegistry,
      { provide: RECIPIENT_RESOLVER_PORT, useClass: StubRecipientResolver },
      { provide: EXECUTOR_PORT, useClass: StubExecutor },
    ],
  }).compile();
}

// The mutex and the optimistic version guard do different jobs. Proving
// that took two separate designs below:
//
//  - The version guard alone *already* serializes two concurrent writers
//    targeting the same key/version — a plain compare-and-swap catches that
//    with no mutex involved. So a naive "both calls try to save" race does
//    NOT prove the mutex has teeth; the version guard would silently save
//    it regardless.
//  - What only the mutex prevents is a *duplicate side effect*: without it,
//    two racing turns can both run a step's port call (e.g.
//    resolve_recipient's RecipientResolverPort.resolve()) before either one
//    saves — the version guard only catches the storage race, not the work
//    already done getting there. That's the scenario the "has teeth" test
//    below is built around.
//  - Separately, the version guard is proven on its own by simulating "a
//    lock that expired mid-processing": a holder saves against a version it
//    loaded, after a different write has already landed.
describe('Conversation FSM: concurrency', () => {
  let moduleRef: TestingModule;
  let conversation: ConversationService;
  let stateStore: StateStore;
  let recipientResolver: StubRecipientResolver;

  beforeAll(async () => {
    moduleRef = await buildModule();
    conversation = moduleRef.get(ConversationService);
    stateStore = moduleRef.get(StateStore);
    recipientResolver = moduleRef.get(RECIPIENT_RESOLVER_PORT);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('mutex: exactly one of two parallel messages for the same session advances; the other is dropped', async () => {
    const userId = randomUUID();
    const channel: ChannelName = 'telegram_dm';
    const base = { userId, channel };

    await conversation.advance({ ...base, kind: 'start_transfer' });

    const [a, b] = await Promise.all([
      conversation.advance({ ...base, kind: 'input', payload: { recipientQuery: 'race-a' } }),
      conversation.advance({ ...base, kind: 'input', payload: { recipientQuery: 'race-b' } }),
    ]);

    const results = [a, b];
    expect(results.filter((r) => r !== undefined)).toHaveLength(1);
    expect(results.filter((r) => r === undefined)).toHaveLength(1);

    // resolve_recipient's port call ran exactly once — the loser never got
    // in far enough to run it at all.
    expect(recipientResolver.calls).toHaveLength(1);

    // Exactly one write happened for this turn — v went from 1 (post-start) to 2, not 3.
    const session = await stateStore.load(`fsm:${userId}:${channel}`);
    expect(session?.v).toBe(2);
  });

  it('version guard: a save with a stale ifVersion is rejected even when the lock itself is no longer held', async () => {
    const key = `fsm:concurrency-version-${randomUUID()}`;
    const fresh = stateStore.fresh();
    const staleVersion = fresh.v;
    const holderASession = { ...fresh, flow: 'transfer', step: 'await_recipient' };

    // Simulates a lock that expired mid-processing: a different write lands
    // and commits (v: 0 -> 1) while "holder A" is still working off the
    // version it originally loaded.
    const fasterWrite = await stateStore.save(key, { ...fresh, step: 'await_amount' }, 0);
    expect(fasterWrite?.v).toBe(1);

    const staleResult = await stateStore.save(key, holderASession, staleVersion);
    expect(staleResult).toBeNull();

    const current = await stateStore.load(key);
    expect(current?.step).toBe('await_amount'); // the faster write's state, untouched by the stale one
    expect(current?.v).toBe(1);
  });

  it('has teeth: without the mutex, a racing duplicate can run a step\'s side effect twice', async () => {
    const raceModuleRef = await buildModule();
    const raceConversation = raceModuleRef.get(ConversationService);
    const raceStateStore = raceModuleRef.get(StateStore);
    const raceResolver: StubRecipientResolver = raceModuleRef.get(RECIPIENT_RESOLVER_PORT);

    const original = raceStateStore.acquire.bind(raceStateStore);
    // Simulate "no lock": every acquire attempt "succeeds" instead of
    // contending on SET NX — exactly what StateStore.acquire would do if
    // its NX guard were removed.
    raceStateStore.acquire = () => Promise.resolve(randomUUID());

    try {
      const userId = randomUUID();
      const channel: ChannelName = 'telegram_dm';
      const base = { userId, channel };

      await raceConversation.advance({ ...base, kind: 'start_transfer' });

      await Promise.all([
        raceConversation.advance({ ...base, kind: 'input', payload: { recipientQuery: 'race-a' } }),
        raceConversation.advance({ ...base, kind: 'input', payload: { recipientQuery: 'race-b' } }),
      ]);

      // Without the mutex, both concurrent turns ran resolve_recipient's
      // port call before either one's save landed — exactly the duplicate
      // work the lock (proven in the first test above) prevents.
      expect(raceResolver.calls.length).toBeGreaterThan(1);
    } finally {
      raceStateStore.acquire = original;
      await raceModuleRef.close();
    }
  });
});
