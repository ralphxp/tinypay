import { Module } from '@nestjs/common';
import { NluService } from './nlu.service.js';
import { NormalizerService } from './normalizer.js';

@Module({
  providers: [NluService, NormalizerService],
  exports: [NluService, NormalizerService],
})
export class NluModule {}
