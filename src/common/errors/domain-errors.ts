export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** FSM step failed validation; conversation should re-prompt the same step. */
export class StepError extends DomainError {
  constructor(message: string) {
    super(message, 'STEP_ERROR');
  }
}

/** Redis session lock could not be acquired (concurrent advance() on same session). */
export class LockError extends DomainError {
  constructor(message = 'Could not acquire session lock') {
    super(message, 'LOCK_ERROR');
  }
}

/** KYC tier cap (single/daily/balance) would be breached by this posting. */
export class TierLimitError extends DomainError {
  constructor(message: string) {
    super(message, 'TIER_LIMIT_ERROR');
  }
}

/** Journal entry postings do not sum to zero. Treat as sev-1. */
export class LedgerImbalanceError extends DomainError {
  constructor(message: string) {
    super(message, 'LEDGER_IMBALANCE_ERROR');
  }
}

/** Actor lacks the role/auth required by the resolver for this action. */
export class UnauthorizedActionError extends DomainError {
  constructor(message: string) {
    super(message, 'UNAUTHORIZED_ACTION_ERROR');
  }
}

/** Verb was invoked from a surface/context it isn't valid for (e.g. `contribute` in a DM). */
export class InvalidVerbContextError extends DomainError {
  constructor(message: string) {
    super(message, 'INVALID_VERB_CONTEXT_ERROR');
  }
}
