import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { ConfigService } from '../../config/config.service.js';

export type PrismaTransactionClient = Prisma.TransactionClient;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: ConfigService) {
    super({ adapter: new PrismaPg({ connectionString: config.get('DATABASE_URL') }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Runs `fn` inside a single serializable-enough transaction. Every ledger
   * mutation (postEntry, balance updates under FOR UPDATE) must go through
   * this rather than issuing standalone queries.
   */
  withTransaction<T>(fn: (tx: PrismaTransactionClient) => Promise<T>): Promise<T> {
    return this.$transaction(fn);
  }
}
