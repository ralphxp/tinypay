import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../../infra/database/prisma.service.js';
import { DomainError } from '../../common/errors/domain-errors.js';

const PIN_PATTERN = /^\d{4,6}$/;

export class InvalidPinError extends DomainError {
  constructor(message: string) {
    super(message, 'INVALID_PIN_ERROR');
  }
}

@Injectable()
export class PinService {
  constructor(private readonly prisma: PrismaService) {}

  /** Sets (or replaces) the PIN. Only ever reached through web/WebAuthn — never over chat. */
  async setPin(userId: string, pin: string): Promise<void> {
    if (!PIN_PATTERN.test(pin)) {
      throw new InvalidPinError('PIN must be 4-6 digits');
    }
    const pinHash = await argon2.hash(pin, { type: argon2.argon2id });
    await this.prisma.credential.upsert({
      where: { userId },
      update: { pinHash },
      create: { userId, pinHash },
    });
  }

  async verifyPin(userId: string, pin: string): Promise<boolean> {
    const credential = await this.prisma.credential.findUnique({ where: { userId } });
    if (!credential?.pinHash) return false;
    return argon2.verify(credential.pinHash, pin);
  }
}
