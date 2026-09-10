import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../../config/config.service.js';
import { DomainError } from '../../../common/errors/domain-errors.js';

const BASE_URL = 'https://api.paystack.co';

export class PaystackApiError extends DomainError {
  constructor(message: string) {
    super(message, 'PAYSTACK_API_ERROR');
  }
}

interface PaystackEnvelope<T> {
  status: boolean;
  message: string;
  data: T;
}

@Injectable()
export class PaystackClient {
  constructor(private readonly config: ConfigService) {}

  async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.config.get('PAYSTACK_SECRET_KEY')}`,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const json = (await response.json()) as PaystackEnvelope<T>;
    if (!response.ok || !json.status) {
      throw new PaystackApiError(json.message ?? `Paystack request to ${path} failed`);
    }
    return json.data;
  }
}
