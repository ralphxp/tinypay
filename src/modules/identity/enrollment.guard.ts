import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { EnrollmentService } from './enrollment.service.js';

/**
 * Pipeline-facing wrapper around EnrollmentService — runs first, ahead of
 * InvocationGate/NLU/SourceAccountResolver (see ConversationService.handleText).
 * Answers exactly one question: "known user?" It performs no transaction
 * authorization, no PIN check, no second factor — that boundary is the
 * whole point of this module. A known user still has to clear PIN/WebAuthn
 * (auth, a later slice) before any debit executes; this gate never touches
 * that path.
 */
@Injectable()
export class EnrollmentGuard {
  constructor(private readonly enrollment: EnrollmentService) {}

  /** Throws NotEnrolledError (with an onboarding hand-off) for an unknown sender phone. */
  checkEnrollment(senderPhone: string): Promise<User> {
    return this.enrollment.requireEnrolled(senderPhone);
  }
}
