import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service.js';
import type { Session } from './types.js';

const SESSION_TTL_MS = 10 * 60 * 1000;

interface SessionRow {
  data: Session | null;
  version: number;
}

interface LockRow {
  lockToken: string;
}

/**
 * Pure state + locking for the conversation FSM — no business logic here.
 * Sessions are transient and non-authoritative for money (guiding principle
 * #1): everything this class holds can be lost without losing a kobo.
 *
 * No Redis in this build — session data, the optimistic-concurrency version,
 * and the per-session mutex all live in one `conversation_sessions` row
 * (ConversationSession model), using Postgres's `INSERT ... ON CONFLICT ...
 * DO UPDATE ... WHERE` as the atomic compare-and-swap/compare-and-acquire
 * primitive in place of Redis's Lua scripts.
 */
@Injectable()
export class StateStore {
  constructor(private readonly prisma: PrismaService) {}

  fresh(): Session {
    const now = Date.now();
    return { flow: null, step: null, slots: {}, attempts: 0, v: 0, createdAt: now, updatedAt: now, history: [] };
  }

  async load(key: string): Promise<Session | null> {
    const rows = await this.prisma.$queryRaw<SessionRow[]>`
      SELECT data, version
      FROM conversation_sessions
      WHERE key = ${key} AND (expires_at IS NULL OR expires_at > now())
    `;
    const row = rows[0];
    if (!row?.data) return null;
    return row.data;
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
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const data = JSON.stringify(toPersist);

    const rows = await this.prisma.$queryRaw<SessionRow[]>`
      INSERT INTO conversation_sessions AS cs (key, data, version, expires_at, updated_at)
      VALUES (${key}, ${data}::jsonb, 1, ${expiresAt}, now())
      ON CONFLICT (key) DO UPDATE
        SET data = ${data}::jsonb,
            version = cs.version + 1,
            expires_at = ${expiresAt},
            updated_at = now()
        WHERE cs.version = ${ifVersion}
      RETURNING data, version
    `;
    return rows[0]?.data ? toPersist : null;
  }

  /** Deletes the session outright — used to simulate/force expiry in tests, and by explicit "cancel". */
  async clear(key: string): Promise<void> {
    await this.prisma.$executeRaw`DELETE FROM conversation_sessions WHERE key = ${key}`;
  }

  /**
   * Acquires a short-lived per-session mutex, returning a random token the
   * holder must present to release() — so a holder can never release a lock
   * it doesn't own (e.g. one it held that already expired and was
   * re-acquired by another process). Succeeds if the row has no lock, or its
   * lock already expired.
   */
  async acquire(key: string, ttlMs: number): Promise<string | null> {
    const token = randomUUID();
    const lockExpiresAt = new Date(Date.now() + ttlMs);

    const rows = await this.prisma.$queryRaw<LockRow[]>`
      INSERT INTO conversation_sessions AS cs (key, lock_token, lock_expires_at, updated_at)
      VALUES (${key}, ${token}, ${lockExpiresAt}, now())
      ON CONFLICT (key) DO UPDATE
        SET lock_token = ${token},
            lock_expires_at = ${lockExpiresAt},
            updated_at = now()
        WHERE cs.lock_token IS NULL OR cs.lock_expires_at < now()
      RETURNING lock_token AS "lockToken"
    `;
    return rows[0] ? token : null;
  }

  async release(key: string, token: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE conversation_sessions
      SET lock_token = NULL, lock_expires_at = NULL, updated_at = now()
      WHERE key = ${key} AND lock_token = ${token}
    `;
  }
}
