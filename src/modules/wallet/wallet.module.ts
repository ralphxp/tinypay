import { Module } from '@nestjs/common';
import { AccountService } from './account.service.js';
import { BalanceService } from './balance.service.js';
import { LimitsService } from './limits.service.js';
import { LedgerService } from './ledger.service.js';

@Module({
  providers: [AccountService, BalanceService, LimitsService, LedgerService],
  exports: [AccountService, BalanceService, LimitsService, LedgerService],
})
export class WalletModule {}
