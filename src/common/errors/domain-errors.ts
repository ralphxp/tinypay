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

/** Wallet debit (airtime/data purchase) would take the balance below zero. */
export class InsufficientBalanceError extends DomainError {
  constructor(message = 'Insufficient wallet balance') {
    super(message, 'INSUFFICIENT_BALANCE_ERROR');
  }
}

/** What a channel needs to send an onboarding DM/link — never sent by the guard itself. */
export interface OnboardingHandoff {
  reason: 'not_enrolled';
  onboardingUrl: string;
}

/**
 * Thrown by EnrollmentGuard when an inbound event's sender phone has no
 * User record — "known user?" only. Every debit still needs its own wallet-
 * balance check on top of this; enrollment is never transaction
 * authorization.
 */
export class NotEnrolledError extends DomainError {
  constructor(public readonly handoff: OnboardingHandoff) {
    super('Sender is not an enrolled TinyPay user', 'NOT_ENROLLED_ERROR');
  }
}
