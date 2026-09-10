import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../infra/redis/redis.module.js';

const LOCK_PREFIX = 'conversation:lock:';
const LOCK_TTL_SECONDS = 15;

/**
 * Per-session Redis lock guarding conversation.service.handleMessage against
 * a second message for the same chat landing while the first is still being
 * processed (e.g. a platform redelivering an update). The session itself
 * carries no money — losing it loses no money (guiding principle #1).
 */
@Injectable()
export class StateStore {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async acquireLock(sessionKey: string): Promise<boolean> {
    const result = await this.redis.set(
      `${LOCK_PREFIX}${sessionKey}`,
      '1',
      'EX',
      LOCK_TTL_SECONDS,
      'NX',
    );
    return result !== null;
  }

  async release(sessionKey: string): Promise<void> {
    await this.redis.del(`${LOCK_PREFIX}${sessionKey}`);
  }
}
