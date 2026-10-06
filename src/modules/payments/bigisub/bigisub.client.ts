import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../../config/config.service.js';
import { ProviderNetworkError, ProviderResponseError } from '../provider.errors.js';

const BASE_URL = 'https://api.bigisub.ng';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 250;

interface BigisubEnvelope<T> {
  success: boolean;
  message: string;
  data: T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * HTTP client for Bigisub (bigisub.ng, "Built and operated by RIF
 * Technotronics Ltd") — same bounded-retry/typed-error discipline as
 * PaystackClient. Confirmed against the real dashboard docs + a live call
 * (GET /api/v2/financial/wallet/balance/): `Authorization: Token <key>`,
 * envelope `{success, message, data}`. Endpoint paths/payloads beyond that
 * (airtime/data purchase) are still a best-effort placeholder — see
 * BigisubProvider's docstring.
 */
@Injectable()
export class BigisubClient {
  constructor(private readonly config: ConfigService) {}

  async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let lastError: ProviderNetworkError | ProviderResponseError | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await this.attempt<T>(method, path, body);
      } catch (err) {
        if (!(err instanceof ProviderNetworkError) && !(err instanceof ProviderResponseError && err.retryable)) {
          throw err;
        }
        lastError = err;
        if (attempt < MAX_ATTEMPTS) {
          await sleep(RETRY_DELAY_MS * attempt);
        }
      }
    }

    throw lastError;
  }

  private async attempt<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: {
          Authorization: `Token ${this.config.get('BIGISUB_API_TOKEN')}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        signal: controller.signal,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch (err) {
      throw new ProviderNetworkError(
        err instanceof Error && err.name === 'AbortError'
          ? `Bigisub request to ${path} timed out after ${REQUEST_TIMEOUT_MS}ms`
          : `Bigisub request to ${path} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }

    const json = (await response.json()) as BigisubEnvelope<T>;
    if (!response.ok || !json.success) {
      const retryable = response.status >= 500;
      throw new ProviderResponseError(
        json.message || `Bigisub request to ${path} failed with status ${response.status}`,
        response.status,
        retryable,
      );
    }
    return json.data;
  }
}
