import { Injectable } from '@nestjs/common';
import type { KycTier } from '@prisma/client';
import { PrismaService } from '../../infra/database/prisma.service.js';

@Injectable()
export class KycService {
  constructor(private readonly prisma: PrismaService) {}

  async getTierCaps(tier: number): Promise<KycTier> {
    return this.prisma.kycTier.findUniqueOrThrow({ where: { tier } });
  }

  async getUserTierCaps(userId: string): Promise<KycTier> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return this.getTierCaps(user.kycTier);
  }

  // BVN verify-and-tokenize (upgrading past tier 1) depends on choosing a BVN
  // provider (docs/SPEC.md section 11, still open) — deferred until then.
}
