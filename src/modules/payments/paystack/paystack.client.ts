import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../../config/config.service.js';
import { ProviderNetworkError, ProviderResponseError } from '../provider.errors.js';

const BASE_URL = 'https://api.paystack.co';
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3; // 1 initial + 2 retries, transient failures only
const RETRY_DELAY_MS = 250;

interface PaystackEnvelope<T> {
  status: boolean;
  message: string;
  data: T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The only place an HTTP call to Paystack is ever made. Every failure —
 * network, timeout, 4xx, 5xx — is mapped to a typed ProviderError before it
 * leaves this class; nothing upstream ever sees a raw fetch rejection or a
 * Paystack response body. Network/5xx failures get a bounded retry; a 4xx is
 * a deterministic rejection and is never retried.
 */
@Injectable()
export class PaystackClient {
  constructor(private readonly config: ConfigService) {}

  async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let lastError: ProviderNetworkError | ProviderResponseError | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await this.attempt<T>(method, path, body);
      } catch (err) {
        if (!(err instanceof ProviderNetworkError) && !(err instanceof ProviderResponseError && err.retryable)) {
          throw err; // a 4xx or any other non-retryable failure — fail immediately
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
          Authorization: `Bearer ${this.config.get('PAYSTACK_SECRET_KEY')}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch (err) {
      throw new ProviderNetworkError(
        err instanceof Error && err.name === 'AbortError'
          ? `Paystack request to ${path} timed out after ${REQUEST_TIMEOUT_MS}ms`
          : `Paystack request to ${path} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }

    const json = (await response.json()) as PaystackEnvelope<T>;
    if (!response.ok || !json.status) {
      const retryable = response.status >= 500;
      throw new ProviderResponseError(
        json.message ?? `Paystack request to ${path} failed with status ${response.status}`,
        response.status,
        retryable,
      );
    }
    return json.data;
  }
}
