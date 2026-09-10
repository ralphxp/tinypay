import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service.js';

@Injectable()
export class EnrollmentService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Enrollment is a front gate, not transaction auth (guiding principle #6):
   * a user is "enrolled" once they have a PIN set. Every debit still needs
   * its own confirm + second factor on top of this.
   */
  async isEnrolled(userId: string): Promise<boolean> {
    const credential = await this.prisma.credential.findUnique({ where: { userId } });
    return credential !== null;
  }
}
