import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../infra/redis/redis.module.js';
import type { Session } from './types.js';

const LOCK_PREFIX = 'lock:';
const SESSION_TTL_MS = 10 * 60 * 1000;

// Atomically checks the lock token before deleting — never release a lock
// acquired by a different holder (e.g. one whose own lock already expired
// and was re-acquired by someone else).
const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
else
  return 0
end
`;

// Atomically checks the stored session's version before overwriting it —
// the classic compare-and-swap, so a slower concurrent writer (one that
// already passed the mutex, e.g. after its lock TTL expired mid-processing)
// can never clobber a newer write with a stale one.
const SAVE_SCRIPT = `
local current = redis.call('GET', KEYS[1])
local currentVersion = 0
if current then
  local decoded = cjson.decode(current)
  currentVersion = decoded.v
end
if currentVersion ~= tonumber(ARGV[1]) then
  return nil
end
redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
return ARGV[2]
`;

/**
 * Pure state + locking for the conversation FSM — no business logic here.
 * Sessions are transient and non-authoritative for money (guiding principle
 * #1): everything this class holds can be lost without losing a kobo.
 */
@Injectable()
export class StateStore {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  fresh(): Session {
    const now = Date.now();
    return { flow: null, step: null, slots: {}, attempts: 0, v: 0, createdAt: now, updatedAt: now, history: [] };
  }

  async load(key: string): Promise<Session | null> {
    const raw = await this.redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as Session;
  }

  /**
   * Persists `session` under `key` iff the currently stored version still
   * equals `ifVersion` (or the key doesn't exist yet and ifVersion is 0).
   * Returns the persisted session (with `v` bumped and `updatedAt` set) on
   * success, or null on a version conflict — the caller's write lost a race
   * against a newer one and must not double-apply.
   */
  async save(key: string, session: Session, ifVersion: number): Promise<Session | null> {
    const toPersist: Session = { ...session, v: ifVersion + 1, updatedAt: Date.now() };
    const result = await this.redis.eval(
      SAVE_SCRIPT,
      1,
      key,
      ifVersion,
      JSON.stringify(toPersist),
      SESSION_TTL_MS,
    );
    return result === null ? null : toPersist;
  }

  /** Deletes the session outright — used to simulate/force expiry in tests, and by explicit "cancel". */
  async clear(key: string): Promise<void> {
    await this.redis.del(key);
  }

  /**
   * Acquires a short-lived per-session mutex via SET NX PX, returning a
   * random token the holder must present to release() — so a holder can
   * never release a lock it doesn't own (e.g. one it held that already
   * expired and was re-acquired by another process).
   */
  async acquire(key: string, ttlMs: number): Promise<string | null> {
    const token = randomUUID();
    const result = await this.redis.set(`${LOCK_PREFIX}${key}`, token, 'PX', ttlMs, 'NX');
    return result === null ? null : token;
  }

  async release(key: string, token: string): Promise<void> {
    await this.redis.eval(RELEASE_SCRIPT, 1, `${LOCK_PREFIX}${key}`, token);
  }
}
