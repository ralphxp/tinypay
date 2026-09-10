import { Controller, Get, Inject } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorFunction,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../infra/redis/redis.module.js';
import { PrismaService } from '../../infra/database/prisma.service.js';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    const checks: HealthIndicatorFunction[] = [
      () => this.prismaIndicator.pingCheck('database', this.prisma),
      async () => {
        await this.redis.ping();
        return { redis: { status: 'up' as const } };
      },
    ];
    return this.health.check(checks);
  }
}
