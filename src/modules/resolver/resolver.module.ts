import { Module } from '@nestjs/common';
import { SourceAccountResolver } from './source-account.resolver.js';

@Module({
  providers: [SourceAccountResolver],
  exports: [SourceAccountResolver],
})
export class ResolverModule {}
