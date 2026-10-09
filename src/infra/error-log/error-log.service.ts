import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';

export interface ErrorLogEntry {
  source: string;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
}

/**
 * Operator-only error log (ServerErrorLog) — the durable, queryable home for
 * detail that must never reach a customer (see
 * TelegramNotificationDispatcher's copyFor()) but that's needed to actually
 * diagnose a failure, instead of grepping Render's ephemeral logs.
 *
 * `log()` never throws: a failure to persist a log row must never crash (or
 * mask) whatever actually went wrong, so a write failure here only falls
 * back to the regular logger.
 */
@Injectable()
export class ErrorLogService {
  private readonly logger = new Logger(ErrorLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  log(entry: ErrorLogEntry): void {
    this.prisma.serverErrorLog
      .create({
        data: {
          source: entry.source,
          message: entry.message,
          stack: entry.stack,
          context: entry.context as Prisma.InputJsonValue | undefined,
        },
      })
      .catch((err: unknown) => {
        this.logger.error(`Failed to persist error log (source=${entry.source}): ${entry.message}`, err);
      });
  }
}
