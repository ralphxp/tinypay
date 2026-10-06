import { DomainError } from '../../common/errors/domain-errors.js';

/**
 * Every external payment/biller provider failure (Paystack, Bigisub)
 * surfaces through one of these — core code never sees a raw fetch error or
 * a provider response body. Distinguishing network/timeout from a provider
 * status code is what lets a caller decide whether a bounded retry is worth
 * attempting.
 */
export class ProviderError extends DomainError {
  constructor(message: string, code: string) {
    super(message, code);
  }
}

/** The request never got a response — DNS/connect failure, or it timed out client-side. Always retryable. */
export class ProviderNetworkError extends ProviderError {
  constructor(message: string) {
    super(message, 'PROVIDER_NETWORK_ERROR');
  }
}

/** The provider responded with a non-2xx status. `retryable` is true only for 5xx — 4xx is a deterministic rejection. */
export class ProviderResponseError extends ProviderError {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryable: boolean,
  ) {
    super(message, 'PROVIDER_RESPONSE_ERROR');
  }
}
