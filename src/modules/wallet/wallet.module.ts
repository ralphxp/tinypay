import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service.js';

@Module({
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
