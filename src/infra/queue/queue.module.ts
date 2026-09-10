import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '../../config/config.module.js';
import { ConfigService } from '../../config/config.service.js';
import { WalletModule } from '../../modules/wallet/wallet.module.js';
import { PaymentsModule } from '../../modules/payments/payments.module.js';
import { SettlementProcessor } from './processors/settlement.processor.js';
import { PayoutProcessor } from './processors/payout.processor.js';
import { SETTLEMENT_QUEUE, PAYOUT_QUEUE } from './queue.constants.js';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.get('REDIS_URL') },
      }),
    }),
    BullModule.registerQueue({ name: SETTLEMENT_QUEUE }, { name: PAYOUT_QUEUE }),
    WalletModule,
    PaymentsModule,
  ],
  providers: [SettlementProcessor, PayoutProcessor],
  exports: [BullModule],
})
export class QueueModule {}
