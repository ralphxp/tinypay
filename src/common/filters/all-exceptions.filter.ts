import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { DomainError } from '../errors/domain-errors.js';
import { ErrorLogService } from '../../infra/error-log/error-log.service.js';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly errorLog: ErrorLogService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    if (exception instanceof DomainError) {
      this.logger.warn(`${exception.code}: ${exception.message}`);
      this.errorLog.log({
        source: 'http',
        message: `${exception.code}: ${exception.message}`,
        context: { path: request.path, method: request.method },
      });
      response.status(HttpStatus.UNPROCESSABLE_ENTITY).json({
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        code: exception.code,
        message: exception.message,
      });
      return;
    }

    const stack = exception instanceof Error ? exception.stack : undefined;
    this.logger.error(stack ?? exception);
    this.errorLog.log({
      source: 'http',
      message: exception instanceof Error ? exception.message : String(exception),
      stack,
      context: { path: request.path, method: request.method },
    });
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    });
  }
}
