import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../../infra/database/prisma.service.js';
import { normalizePhone } from '../../shared/utils/phone.js';

export interface CreateUserInput {
  phone: string;
  fullName?: string;
}

/**
 * Phone is the identity join key across every surface (Telegram, WhatsApp).
 * normalizePhone (shared/utils/phone.ts) is the single function every lookup
 * and write goes through here — 0803…, +234803…, and 234803… must all land
 * on the same row, or the wallet ends up split across two accounts for one
 * person.
 */
@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  findByPhone(phone: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { phone: normalizePhone(phone) } });
  }

  findById(userId: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id: userId } });
  }

  /** New users default to status 'active' per the users table default — no secrets set here. */
  create(input: CreateUserInput): Promise<User> {
    return this.prisma.user.create({
      data: { phone: normalizePhone(input.phone), fullName: input.fullName },
    });
  }

  /** Resolves the user for a phone number, creating a bare (unenrolled) record if new. */
  async findOrCreateByPhone(phone: string, fullName?: string): Promise<User> {
    const existing = await this.findByPhone(phone);
    if (existing) return existing;
    return this.create({ phone, fullName });
  }

  /** Set once by the onboarding flow (flows/onboarding.flow.ts) — never asked for again. */
  async updateEmail(userId: string, email: string): Promise<void> {
    await this.prisma.user.update({ where: { id: userId }, data: { email } });
  }

  /**
   * Telegram/WhatsApp identify senders by their own native id, not
   * necessarily a phone directly usable as-is — these map a returning chat
   * back to the phone-keyed identity after first contact (Telegram, via a
   * shared contact card) or directly (WhatsApp, whose id already is the
   * phone, still stored separately so the two never collide).
   */
  findByTelegramUserId(telegramUserId: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { telegramUserId } });
  }

  async linkTelegramUserId(userId: string, telegramUserId: string): Promise<void> {
    await this.prisma.user.update({ where: { id: userId }, data: { telegramUserId } });
  }

  findByWhatsappUserId(whatsappUserId: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { whatsappUserId } });
  }

  async linkWhatsappUserId(userId: string, whatsappUserId: string): Promise<void> {
    await this.prisma.user.update({ where: { id: userId }, data: { whatsappUserId } });
  }
}
