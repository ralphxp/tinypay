import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../../infra/database/prisma.service.js';

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  findByPhone(phone: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { phone } });
  }

  findById(userId: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id: userId } });
  }

  /** Resolves the user for a phone number, creating a bare (unenrolled) record if new. */
  async findOrCreateByPhone(phone: string): Promise<User> {
    const existing = await this.findByPhone(phone);
    if (existing) return existing;
    return this.prisma.user.create({ data: { phone } });
  }

  findByTelegramUserId(telegramUserId: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { telegramUserId } });
  }

  async linkTelegramUserId(userId: string, telegramUserId: string): Promise<void> {
    await this.prisma.user.update({ where: { id: userId }, data: { telegramUserId } });
  }
}
