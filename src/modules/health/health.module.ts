import { Module } from '@nestjs/common';
import { TelegramCoreModule } from '../channels/telegram/telegram-core.module.js';
import { HealthController } from './health.controller.js';

@Module({
  imports: [TelegramCoreModule],
  controllers: [HealthController],
})
export class HealthModule {}
