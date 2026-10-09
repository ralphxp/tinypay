import { randomInt } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '../../src/config/config.module.js';
import { ConfigService } from '../../src/config/config.service.js';
import { PrismaModule } from '../../src/infra/database/prisma.module.js';
import { ConversationModule } from '../../src/modules/conversation/conversation.module.js';
import { IdentityModule } from '../../src/modules/identity/identity.module.js';
import { UserService } from '../../src/modules/identity/user.service.js';
import { WalletService } from '../../src/modules/wallet/wallet.service.js';
import { BILLER_PORT, StubBillerProvider } from '../../src/modules/payments/biller.port.js';
import { TwilioClient } from '../../src/modules/channels/whatsapp/twilio-client.js';
import { WhatsAppAdapter } from '../../src/modules/channels/whatsapp/whatsapp.adapter.js';

function freshPhoneDigits(): string {
  return `0805${randomInt(1_000_000, 9_999_999)}`;
}

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) } as Response;
}

describe('WhatsAppAdapter: Twilio as BSP — no contact-share step, numbered replies instead of buttons', () => {
  let moduleRef: TestingModule;
  let adapter: WhatsAppAdapter;
  let users: UserService;
  let wallet: WalletService;
  let config: ConfigService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, PrismaModule, IdentityModule, ConversationModule],
      providers: [TwilioClient, WhatsAppAdapter],
    })
      .overrideProvider(BILLER_PORT)
      .useClass(StubBillerProvider)
      .compile();

    adapter = moduleRef.get(WhatsAppAdapter);
    users = moduleRef.get(UserService);
    wallet = moduleRef.get(WalletService);
    config = moduleRef.get(ConfigService);
    vi.spyOn(config, 'get').mockImplementation(((key: string) => {
      if (key === 'TWILIO_WHATSAPP_NUMBER') return 'whatsapp:+14155238886';
      if (key === 'TWILIO_ACCOUNT_SID') return 'ACtest';
      if (key === 'TWILIO_AUTH_TOKEN') return 'test_token';
      return ConfigService.prototype.get.call(config, key as never);
    }) as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  function capturedSends(): { to: string; body: string }[] {
    const calls: { to: string; body: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        const params = new URLSearchParams(init?.body as string);
        calls.push({ to: params.get('To')!, body: params.get('Body')! });
        return Promise.resolve(jsonResponse(200, { sid: 'SM123' }));
      }),
    );
    return calls;
  }

  it('an unknown phone is auto-enrolled on first message — no separate linking step', async () => {
    const digits = freshPhoneDigits();
    const sends = capturedSends();

    await adapter.handleIncoming({ From: `whatsapp:+234${digits.slice(1)}`, Body: 'tinypay balance' });

    const user = await users.findByPhone(`+234${digits.slice(1)}`);
    expect(user).not.toBeNull();
    expect(sends).toHaveLength(1);
    expect(sends[0]!.body).toContain('₦0.00');
  });

  it('a numbered reply resolves to the same value a tap would send', async () => {
    const digits = freshPhoneDigits();
    const phone = `+234${digits.slice(1)}`;
    const user = await users.findOrCreateByPhone(phone);
    const fundRef = `tinypay-seed-${randomInt(1e9)}`;
    await wallet.reserveFund({ userId: user.id, ref: fundRef, amountMinor: 1000_00n });
    await wallet.completeFund(fundRef, 'seed-ref');

    const sends = capturedSends();
    const waNumber = `whatsapp:${phone}`;

    await adapter.handleIncoming({ From: waNumber, Body: 'tinypay airtime' });
    expect(sends.at(-1)!.body).toContain('1. MTN');

    await adapter.handleIncoming({ From: waNumber, Body: '1' }); // tap-equivalent: picks MTN by position
    expect(sends.at(-1)!.body.toLowerCase()).toContain('mtn');
    expect(sends.at(-1)!.body).not.toMatch(/which network/i);
  });

  it('a bare number that does not correspond to an active choice list passes through as ordinary text', async () => {
    const digits = freshPhoneDigits();
    const phone = `+234${digits.slice(1)}`;
    await users.findOrCreateByPhone(phone);
    const sends = capturedSends();

    // Idle (no active flow) — resolveNumberedReply only translates a bare
    // number when there's an active step with that many choices, so "1"
    // passes through unchanged; needs the wake word since nothing's active yet.
    await adapter.handleIncoming({ From: `whatsapp:${phone}`, Body: 'tinypay 1' });

    expect(sends).toHaveLength(1);
    expect(sends[0]!.body).toMatch(/didn't catch that/i);
  });
});
