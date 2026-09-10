import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Redis } from 'ioredis';
import { from, of, switchMap, tap } from 'rxjs';
import { REDIS_CLIENT } from '../../infra/redis/redis.module.js';
import { IDEMPOTENT_SCOPE_KEY } from '../decorators/idempotent.decorator.js';

const IDEMPOTENCY_HEADER = 'idempotency-key';
const TTL_SECONDS = 60 * 60 * 24;

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const scope = this.reflector.get<string | undefined>(
      IDEMPOTENT_SCOPE_KEY,
      context.getHandler(),
    );
    if (!scope) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const key = request.headers[IDEMPOTENCY_HEADER] as string | undefined;
    if (!key) {
      throw new BadRequestException(`Missing required "${IDEMPOTENCY_HEADER}" header`);
    }

    const redisKey = `idempotency:${scope}:${key}`;
    return from(this.redis.get(redisKey)).pipe(
      switchMap((cached) => {
        if (cached !== null) {
          return of(JSON.parse(cached) as unknown);
        }
        return next.handle().pipe(
          tap((result: unknown) => {
            void this.redis.set(redisKey, JSON.stringify(result), 'EX', TTL_SECONDS);
          }),
        );
      }),
    );
  }
}
