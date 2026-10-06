import { Module } from '@nestjs/common';
import { NluService } from './nlu.service.js';

@Module({
  providers: [NluService],
  exports: [NluService],
})
export class NluModule {}
