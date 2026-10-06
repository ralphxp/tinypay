import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '../../src/config/config.module.js';
import { ConfigService } from '../../src/config/config.service.js';
import { BigisubClient } from '../../src/modules/payments/bigisub/bigisub.client.js';
import { BigisubProvider } from '../../src/modules/payments/bigisub/bigisub.provider.js';
import { ProviderResponseError } from '../../src/modules/payments/provider.errors.js';

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe('BigisubClient/BigisubProvider: confirmed against the real dashboard docs + a live call', () => {
  let moduleRef: TestingModule;
  let provider: BigisubProvider;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule],
      providers: [BigisubClient, BigisubProvider],
    }).compile();
    provider = moduleRef.get(BigisubProvider);
    const config = moduleRef.get(ConfigService);
    vi.spyOn(config, 'get').mockImplementation(((key: string) => {
      if (key === 'BIGISUB_API_TOKEN') return 'test_token';
      return ConfigService.prototype.get.call(config, key as never);
    }) as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('getWalletBalance unwraps the real {success, message, data} envelope and converts to minor units', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        expect(url).toBe('https://api.bigisub.ng/api/v2/financial/wallet/balance/');
        return Promise.resolve(
          jsonResponse(200, {
            success: true,
            message: 'Wallet balance retrieved successfully',
            data: {
              id: 67031,
              username: 'raphapanchi',
              balance: '100.00',
              pending_amount: '0.00',
              referal_balance: 0,
              user_type: 'Regular',
            },
          }),
        );
      }),
    );

    const balance = await provider.getWalletBalance();

    expect(balance).toEqual({ balanceMinor: 100_00n, pendingAmountMinor: 0n, username: 'raphapanchi' });
  });

  it('sends the confirmed auth scheme — Authorization: Token <key>', async () => {
    let capturedAuth: string | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        capturedAuth = (init?.headers as Record<string, string> | undefined)?.Authorization;
        return Promise.resolve(
          jsonResponse(200, { success: true, message: 'ok', data: { username: 'x', balance: '0', pending_amount: '0' } }),
        );
      }),
    );

    await provider.getWalletBalance();

    expect(capturedAuth).toBe('Token test_token');
  });

  it('a {success: false} body (even with HTTP 200) is surfaced as a ProviderResponseError, not silently accepted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(jsonResponse(200, { success: false, message: 'Invalid API token', data: null })),
      ),
    );

    await expect(provider.getWalletBalance()).rejects.toMatchObject({
      message: 'Invalid API token',
    });
  });

  it('a 5xx is retried up to the bounded limit before surfacing a retryable ProviderResponseError', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(jsonResponse(503, { success: false, message: 'Service unavailable', data: null })),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const err = await provider.getWalletBalance().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ProviderResponseError);
    expect((err as ProviderResponseError).retryable).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });
});
