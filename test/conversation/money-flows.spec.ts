import { randomInt } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '../../src/config/config.module.js';
import { PrismaModule } from '../../src/infra/database/prisma.module.js';
import { ConversationModule } from '../../src/modules/conversation/conversation.module.js';
import { ConversationService } from '../../src/modules/conversation/conversation.service.js';
import { StateStore } from '../../src/modules/conversation/state.store.js';
import { UserService } from '../../src/modules/identity/user.service.js';
import { WalletService } from '../../src/modules/wallet/wallet.service.js';
import { BILLER_PORT, StubBillerProvider } from '../../src/modules/payments/biller.port.js';
import type { ChannelName, HandleTextInput } from '../../src/modules/conversation/types.js';

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function freshPhone(): string {
  return `+234804${randomInt(1_000_000, 9_999_999)}`;
}

function dm(senderPhone: string, text: string): HandleTextInput {
  return { senderPhone, channel: 'telegram_dm' as ChannelName, surface: 'telegram_dm', text };
}

describe('Money flows: fund / airtime / data, end to end through ConversationService', () => {
  let moduleRef: TestingModule;
  let conversation: ConversationService;
  let stateStore: StateStore;
  let users: UserService;
  let wallet: WalletService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, PrismaModule, ConversationModule],
    })
      .overrideProvider(BILLER_PORT)
      .useClass(StubBillerProvider)
      .compile();

    conversation = moduleRef.get(ConversationService);
    stateStore = moduleRef.get(StateStore);
    users = moduleRef.get(UserService);
    wallet = moduleRef.get(WalletService);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  async function enrolledPhone(): Promise<string> {
    const phone = freshPhone();
    await users.create({ phone });
    return phone;
  }

  describe('fund', () => {
    it('asks for an amount, then mints a Paystack checkout link and ends the chat-visible flow there', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve(
            jsonResponse(200, {
              status: true,
              message: 'ok',
              data: { authorization_url: 'https://checkout.paystack.com/abc123', access_code: 'abc', reference: 'ignored' },
            }),
          ),
        ),
      );

      const phone = await enrolledPhone();
      const user = await users.findByPhone(phone);

      const seeded = await conversation.handleText(dm(phone, 'tinypay fund'));
      expect(seeded?.text).toContain('How much');

      const result = await conversation.advance({
        userId: user!.id,
        channel: 'telegram_dm',
        kind: 'input',
        payload: { text: '500' },
      });

      expect(result?.text).toContain('Tap to pay');
      expect(result?.text).toContain('https://checkout.paystack.com/abc123');

      const session = await stateStore.load(`fsm:${user!.id}:telegram_dm`);
      expect(session?.flow).toBeNull(); // terminal step resets to idle immediately

      // Reserved as pending, not yet credited — only the charge.success webhook credits it.
      expect(await wallet.getBalance(user!.id)).toBe(0n);
    });

    it('a mid-flow reply still prefixed with the wake word out of habit (real user behavior, via handleText — not advance() directly) still parses correctly', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve(
            jsonResponse(200, {
              status: true,
              message: 'ok',
              data: { authorization_url: 'https://checkout.paystack.com/xyz789', access_code: 'xyz', reference: 'ignored' },
            }),
          ),
        ),
      );

      const phone = await enrolledPhone();

      const seeded = await conversation.handleText(dm(phone, 'tinypay fund'));
      expect(seeded?.text).toContain('How much');

      // A real user, having learned "tinypay" starts every message, keeps
      // typing it even mid-flow — handleText (not advance() directly) is
      // what actually exercises InvocationGate's wake-word stripping.
      const result = await conversation.handleText(dm(phone, 'tinypay 500'));

      expect(result?.text).toContain('Tap to pay');
      expect(result?.text).toContain('https://checkout.paystack.com/xyz789');
    });

    it('a fully-specified "tinypay fund 1000" seeds straight past the amount question', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve(
            jsonResponse(200, {
              status: true,
              message: 'ok',
              data: { authorization_url: 'https://checkout.paystack.com/xyz', access_code: 'xyz', reference: 'ignored' },
            }),
          ),
        ),
      );

      const phone = await enrolledPhone();
      const reply = await conversation.handleText(dm(phone, 'tinypay fund 1000'));

      expect(reply?.text).toContain('Tap to pay');
      expect(reply?.text).toContain('₦1,000.00');
    });
  });

  describe('airtime', () => {
    it('network -> amount -> confirm -> purchased, debiting the wallet and reporting success', async () => {
      const phone = await enrolledPhone();
      const user = await users.findByPhone(phone);

      // Seed a real balance via the wallet service's own funding path for realism.
      const fundRef = `tinypay:seed:${randomInt(1e9)}`;
      await wallet.reserveFund({ userId: user!.id, ref: fundRef, amountMinor: 1000_00n });
      await wallet.completeFund(fundRef, 'seed-provider-ref');
      expect(await wallet.getBalance(user!.id)).toBe(1000_00n);

      const askedNetwork = await conversation.handleText(dm(phone, 'tinypay airtime'));
      expect(askedNetwork?.choices).toEqual(['MTN', 'Glo', 'Airtel', '9mobile']);

      const askedAmount = await conversation.advance({
        userId: user!.id,
        channel: 'telegram_dm',
        kind: 'input',
        payload: { value: 'MTN' },
      });
      expect(askedAmount?.text).toContain('MTN airtime');

      const askedRecipient = await conversation.advance({
        userId: user!.id,
        channel: 'telegram_dm',
        kind: 'input',
        payload: { text: '200' },
      });
      expect(askedRecipient?.choices).toEqual(['Myself']);

      const askedConfirm = await conversation.advance({
        userId: user!.id,
        channel: 'telegram_dm',
        kind: 'input',
        payload: { value: 'Myself' },
      });
      expect(askedConfirm?.text).toContain('₦200.00');
      expect(askedConfirm?.choices).toEqual(['yes', 'cancel']);

      const done = await conversation.advance({
        userId: user!.id,
        channel: 'telegram_dm',
        kind: 'input',
        payload: { value: 'yes' },
      });

      expect(done?.text).toContain('Done!');
      expect(done?.text).toContain('MTN airtime sent');
      expect(await wallet.getBalance(user!.id)).toBe(800_00n); // 1000 - 200

      const history = await wallet.listTransactions(user!.id, 5);
      expect(history[0]!.type).toBe('airtime');
      expect(history[0]!.status).toBe('completed');
    });

    it('insufficient balance re-prompts await_confirm rather than crashing, and never debits', async () => {
      const phone = await enrolledPhone();
      const user = await users.findByPhone(phone);
      // Balance stays at 0 — never funded.

      await conversation.handleText(dm(phone, 'tinypay airtime'));
      await conversation.advance({
        userId: user!.id,
        channel: 'telegram_dm',
        kind: 'input',
        payload: { value: 'MTN' },
      });
      await conversation.advance({
        userId: user!.id,
        channel: 'telegram_dm',
        kind: 'input',
        payload: { text: '500' },
      });
      const confirmPrompt = await conversation.advance({
        userId: user!.id,
        channel: 'telegram_dm',
        kind: 'input',
        payload: { value: 'Myself' },
      });
      expect(confirmPrompt?.choices).toEqual(['yes', 'cancel']);

      const reply = await conversation.advance({
        userId: user!.id,
        channel: 'telegram_dm',
        kind: 'input',
        payload: { value: 'yes' },
      });

      expect(reply?.text).toMatch(/insufficient/i);
      expect(await wallet.getBalance(user!.id)).toBe(0n);

      const session = await stateStore.load(`fsm:${user!.id}:telegram_dm`);
      expect(session?.step).toBe('await_confirm'); // reverted to re-confirm, not stuck or reset
    });

    it('can buy for someone else — a phone named in the opening message skips await_recipient_phone entirely', async () => {
      const phone = await enrolledPhone();
      const user = await users.findByPhone(phone);
      const fundRef = `tinypay:seed:${randomInt(1e9)}`;
      await wallet.reserveFund({ userId: user!.id, ref: fundRef, amountMinor: 1000_00n });
      await wallet.completeFund(fundRef, 'seed-provider-ref');

      const seeded = await conversation.handleText(dm(phone, 'tinypay send airtime 500 mtn 08011112222'));
      // Every slot (network, amount, recipient) was named inline — straight to confirm.
      expect(seeded?.text).toContain('+2348011112222');
      expect(seeded?.choices).toEqual(['yes', 'cancel']);

      const done = await conversation.advance({
        userId: user!.id,
        channel: 'telegram_dm',
        kind: 'input',
        payload: { value: 'yes' },
      });
      expect(done?.text).toContain('+2348011112222');
    });

    it('can buy for someone else — typing a phone instead of tapping "Myself" at await_recipient_phone', async () => {
      const phone = await enrolledPhone();
      const user = await users.findByPhone(phone);
      const fundRef = `tinypay:seed:${randomInt(1e9)}`;
      await wallet.reserveFund({ userId: user!.id, ref: fundRef, amountMinor: 1000_00n });
      await wallet.completeFund(fundRef, 'seed-provider-ref');

      await conversation.handleText(dm(phone, 'tinypay airtime'));
      await conversation.advance({
        userId: user!.id,
        channel: 'telegram_dm',
        kind: 'input',
        payload: { value: 'MTN' },
      });
      const askedRecipient = await conversation.advance({
        userId: user!.id,
        channel: 'telegram_dm',
        kind: 'input',
        payload: { text: '200' },
      });
      expect(askedRecipient?.choices).toEqual(['Myself']); // can still just type a different number instead

      const confirmPrompt = await conversation.advance({
        userId: user!.id,
        channel: 'telegram_dm',
        kind: 'input',
        payload: { text: '08033334444' },
      });
      expect(confirmPrompt?.text).toContain('+2348033334444');
      expect(confirmPrompt?.text).not.toContain(phone); // not the buyer's own number
    });
  });

  describe('data', () => {
    it('network -> plan -> confirm -> purchased', async () => {
      const phone = await enrolledPhone();
      const user = await users.findByPhone(phone);
      const fundRef = `tinypay:seed:${randomInt(1e9)}`;
      await wallet.reserveFund({ userId: user!.id, ref: fundRef, amountMinor: 1000_00n });
      await wallet.completeFund(fundRef, 'seed-provider-ref');

      await conversation.handleText(dm(phone, 'tinypay data'));
      const planPrompt = await conversation.advance({
        userId: user!.id,
        channel: 'telegram_dm',
        kind: 'input',
        payload: { value: 'Glo' },
      });
      expect(planPrompt?.choices?.length).toBeGreaterThan(0);
      const firstPlanChoice = planPrompt!.choices![0]!;
      expect(firstPlanChoice).toHaveProperty('value'); // {label, value} — a short tappable value, not the long label

      const askedRecipient = await conversation.advance({
        userId: user!.id,
        channel: 'telegram_dm',
        kind: 'input',
        payload: { value: (firstPlanChoice as { value: string }).value },
      });
      expect(askedRecipient?.choices).toEqual(['Myself']);

      const confirmPrompt = await conversation.advance({
        userId: user!.id,
        channel: 'telegram_dm',
        kind: 'input',
        payload: { value: 'Myself' },
      });
      expect(confirmPrompt?.choices).toEqual(['yes', 'cancel']);

      const done = await conversation.advance({
        userId: user!.id,
        channel: 'telegram_dm',
        kind: 'input',
        payload: { value: 'yes' },
      });

      expect(done?.text).toContain('Done!');
      expect(await wallet.getBalance(user!.id)).toBe(1000_00n - 300_00n); // the 1GB placeholder plan's price
    });
  });

  describe('balance and history', () => {
    it('balance reports the real wallet balance, not a stub', async () => {
      const phone = await enrolledPhone();
      const user = await users.findByPhone(phone);
      const fundRef = `tinypay:seed:${randomInt(1e9)}`;
      await wallet.reserveFund({ userId: user!.id, ref: fundRef, amountMinor: 1234_00n });
      await wallet.completeFund(fundRef, 'seed-provider-ref');

      const reply = await conversation.handleText(dm(phone, 'tinypay balance'));
      expect(reply?.text).toContain('₦1,234.00');
    });

    it('history lists recent transactions', async () => {
      const phone = await enrolledPhone();
      const user = await users.findByPhone(phone);
      const fundRef = `tinypay:seed:${randomInt(1e9)}`;
      await wallet.reserveFund({ userId: user!.id, ref: fundRef, amountMinor: 500_00n });
      await wallet.completeFund(fundRef, 'seed-provider-ref');

      const reply = await conversation.handleText(dm(phone, 'tinypay history'));
      expect(reply?.text).toContain('Funded');
    });
  });

  describe('interrupts', () => {
    it('cancel mid-flow returns to idle without charging anything', async () => {
      const phone = await enrolledPhone();
      const user = await users.findByPhone(phone);

      await conversation.handleText(dm(phone, 'tinypay airtime'));
      const cancelled = await conversation.handleText(dm(phone, 'cancel'));
      expect(cancelled?.text).toBe('Cancelled.');

      const session = await stateStore.load(`fsm:${user!.id}:telegram_dm`);
      expect(session?.flow).toBeNull();
    });
  });
});
