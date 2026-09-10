import { Global, Module } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ConfigModule } from '../../config/config.module.js';
import { ConfigService } from '../../config/config.service.js';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => new Redis(config.get('REDIS_URL')),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
