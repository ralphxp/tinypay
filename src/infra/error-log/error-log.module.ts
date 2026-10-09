import { Global, Module } from '@nestjs/common';
import { ErrorLogService } from './error-log.service.js';

@Global()
@Module({
  providers: [ErrorLogService],
  exports: [ErrorLogService],
})
export class ErrorLogModule {}
