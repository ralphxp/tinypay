import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { UserService } from './user.service.js';
import { ConfigService } from '../../config/config.service.js';
import { NotEnrolledError, type OnboardingHandoff } from '../../common/errors/domain-errors.js';
import { normalizePhone } from '../../shared/utils/phone.js';

/**
 * The front gate: "known user?" only (guiding principle #6 — enrollment is
 * never transaction authorization). A phone resolving to a User row is
 * enrolled, full stop — no PIN, no second factor, no credential lookup
 * happens here. Every debit still needs its own confirm + auth on top of
 * this, checked entirely elsewhere (PinService / WebAuthn, a later slice).
 * Folding that check into this gate is exactly the gap this module exists
 * to avoid.
 */
@Injectable()
export class EnrollmentService {
  constructor(
    private readonly users: UserService,
    private readonly config: ConfigService,
  ) {}

  /** Resolves the known-user gate for a phone; throws NotEnrolledError (carrying the onboarding hand-off) if unknown. */
  async requireEnrolled(phone: string): Promise<User> {
    const user = await this.users.findByPhone(phone);
    if (!user) {
      throw new NotEnrolledError(this.buildOnboardingHandoff(phone));
    }
    return user;
  }

  /** Data a channel needs to send an onboarding DM/link — this service never sends anything itself. */
  buildOnboardingHandoff(phone: string): OnboardingHandoff {
    const base = this.config.get('APP_BASE_URL');
    const url = new URL('/onboarding', base);
    url.searchParams.set('phone', normalizePhone(phone));
    return { reason: 'not_enrolled', onboardingUrl: url.toString() };
  }
}
