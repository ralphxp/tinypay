import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { tap } from 'rxjs';

const CORRELATION_HEADER = 'x-correlation-id';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    const correlationId =
      (request.headers[CORRELATION_HEADER] as string | undefined) ?? randomUUID();
    request.headers[CORRELATION_HEADER] = correlationId;
    response.setHeader(CORRELATION_HEADER, correlationId);

    const start = Date.now();
    return next.handle().pipe(
      tap({
        next: () => {
          this.logger.log(
            `${correlationId} ${request.method} ${request.originalUrl} ${response.statusCode} ${Date.now() - start}ms`,
          );
        },
        error: (err: Error) => {
          this.logger.error(
            `${correlationId} ${request.method} ${request.originalUrl} failed after ${Date.now() - start}ms: ${err.message}`,
          );
        },
      }),
    );
  }
}
