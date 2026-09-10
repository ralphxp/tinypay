import { Injectable } from '@nestjs/common';
import type { Account } from '@prisma/client';
import { PrismaService, type PrismaTransactionClient } from '../../infra/database/prisma.service.js';
import type { AccountRef, CurrencyCode } from '../../shared/types/account.js';

@Injectable()
export class AccountService {
  constructor(private readonly prisma: PrismaService) {}

  /** Finds the account for a ref, creating it (with a zeroed balance row) if it doesn't exist yet. */
  async resolveAccount(
    ref: AccountRef,
    tx: PrismaTransactionClient,
    currency: CurrencyCode = 'NGN',
  ): Promise<Account> {
    const existing = await tx.account.findFirst({
      where: { ownerType: ref.ownerType, ownerId: ref.ownerId, kind: ref.kind },
    });
    if (existing) return existing;

    return tx.account.create({
      data: {
        ownerType: ref.ownerType,
        ownerId: ref.ownerId,
        kind: ref.kind,
        currency,
        balance: { create: { amountMinor: 0n } },
      },
    });
  }

  findById(accountId: string): Promise<Account | null> {
    return this.prisma.account.findUnique({ where: { id: accountId } });
  }

  /** Read-only lookup by ref, for display paths that don't need to create the account. */
  findByRef(ref: AccountRef): Promise<Account | null> {
    return this.prisma.account.findFirst({
      where: { ownerType: ref.ownerType, ownerId: ref.ownerId, kind: ref.kind },
    });
  }
}
