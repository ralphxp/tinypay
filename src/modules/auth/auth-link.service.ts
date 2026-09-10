import { Inject, Injectable } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../infra/redis/redis.module.js';
import { ConfigService } from '../../config/config.service.js';
import { DomainError } from '../../common/errors/domain-errors.js';

export type AuthLinkAction = 'set_pin' | 'confirm_money_action';

export interface AuthLinkPayload<TData = unknown> {
  userId: string;
  action: AuthLinkAction;
  data: TData;
  exp: number; // unix seconds
  jti: string;
}

export class AuthLinkError extends DomainError {
  constructor(message: string) {
    super(message, 'AUTH_LINK_ERROR');
  }
}

const REDIS_USED_PREFIX = 'auth-link:used:';

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/**
 * Short-lived, single-use, action-bound signed links (guiding principle #7 —
 * secrets never touch chat). `data` is signed as part of the payload, so a
 * money-action link (e.g. the exact resolved ledger legs for a transfer)
 * can't be tampered with between confirm and execute.
 */
@Injectable()
export class AuthLinkService {
  constructor(
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  create<TData = undefined>(
    userId: string,
    action: AuthLinkAction,
    data: TData = undefined as TData,
    ttlSeconds = 900,
  ): string {
    const payload: AuthLinkPayload<TData> = {
      userId,
      action,
      data,
      exp: Math.floor(Date.now() / 1000) + ttlSeconds,
      jti: randomUUID(),
    };
    const body = base64url(JSON.stringify(payload));
    const signature = this.sign(body);
    return `${body}.${signature}`;
  }

  createUrl<TData = undefined>(
    userId: string,
    action: AuthLinkAction,
    data: TData = undefined as TData,
    ttlSeconds = 900,
  ): string {
    const token = this.create(userId, action, data, ttlSeconds);
    return `${this.config.get('APP_BASE_URL')}/auth/link/${token}`;
  }

  /** Verifies signature + expiry, then atomically claims the jti so it can't be replayed. */
  async verifyAndConsume<TData = unknown>(token: string): Promise<AuthLinkPayload<TData>> {
    const [body, signature] = token.split('.');
    if (!body || !signature) {
      throw new AuthLinkError('Malformed auth link');
    }

    const expected = this.sign(body);
    if (
      expected.length !== signature.length ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
    ) {
      throw new AuthLinkError('Invalid auth link signature');
    }

    const payload = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8'),
    ) as AuthLinkPayload<TData>;

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      throw new AuthLinkError('Auth link has expired');
    }

    const claimed = await this.redis.set(
      `${REDIS_USED_PREFIX}${payload.jti}`,
      '1',
      'EX',
      Math.max(payload.exp - now, 1),
      'NX',
    );
    if (claimed === null) {
      throw new AuthLinkError('Auth link has already been used');
    }

    return payload;
  }

  private sign(body: string): string {
    return createHmac('sha256', this.config.get('JWT_SECRET')).update(body).digest('base64url');
  }
}
