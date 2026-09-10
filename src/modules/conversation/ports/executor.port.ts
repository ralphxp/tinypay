import { Injectable } from '@nestjs/common';

export const EXECUTOR_PORT = Symbol('EXECUTOR_PORT');

export type ExecutionStatus = 'executed';

export interface ExecutionResult {
  ref: string;
  status: ExecutionStatus;
}

export interface ExecutorPort {
  /** Ground truth for "has this ref already run" — callers must check this before execute(), not rely on execute() alone to dedupe. */
  getStatus(ref: string): Promise<ExecutionResult | null>;
  /** Performs the movement. Callers are expected to have already checked getStatus(). */
  execute(ref: string, amountMinor: bigint, recipientAccountRef: string): Promise<ExecutionResult>;
}

/**
 * Slice 2 stub standing in for the ledger's externalRef dedupe (LedgerService
 * postEntry, wired in a later slice). The FSM layer must not assume this — or
 * the real ledger — will silently absorb a duplicate call; see the
 * `executing` step in flows/transfer.flow.ts, which checks getStatus() before
 * ever calling execute().
 */
@Injectable()
export class StubExecutor implements ExecutorPort {
  /** Refs execute() actually ran for — test-visible call log. */
  readonly calls: string[] = [];
  private readonly results = new Map<string, ExecutionResult>();

  getStatus(ref: string): Promise<ExecutionResult | null> {
    return Promise.resolve(this.results.get(ref) ?? null);
  }

  execute(ref: string): Promise<ExecutionResult> {
    this.calls.push(ref);
    const result: ExecutionResult = { ref, status: 'executed' };
    this.results.set(ref, result);
    return Promise.resolve(result);
  }
}
