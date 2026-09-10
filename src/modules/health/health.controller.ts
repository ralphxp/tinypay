import { Controller, Get, HttpException, HttpStatus, Inject } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../infra/redis/redis.module.js';
import { PrismaService } from '../../infra/database/prisma.service.js';

type ComponentStatus = 'up' | 'down';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Get()
  async check(): Promise<{ status: 'ok' | 'error'; db: ComponentStatus; redis: ComponentStatus }> {
    const [dbResult, redisResult] = await Promise.allSettled([
      this.prisma.$queryRaw`SELECT 1`,
      this.redis.ping(),
    ]);

    const db: ComponentStatus = dbResult.status === 'fulfilled' ? 'up' : 'down';
    const redis: ComponentStatus = redisResult.status === 'fulfilled' ? 'up' : 'down';
    const status: 'ok' | 'error' = db === 'up' && redis === 'up' ? 'ok' : 'error';

    const body = { status, db, redis };
    if (status === 'error') {
      throw new HttpException(body, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return body;
  }
}
