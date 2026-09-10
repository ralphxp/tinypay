import { Module } from '@nestjs/common';
import { PinService } from './pin.service.js';
import { AuthLinkService } from './auth-link.service.js';
import { AuthController } from './auth.controller.js';
import { WalletModule } from '../wallet/wallet.module.js';
import { QueueModule } from '../../infra/queue/queue.module.js';

@Module({
  imports: [WalletModule, QueueModule],
  controllers: [AuthController],
  providers: [PinService, AuthLinkService],
  exports: [PinService, AuthLinkService],
})
export class AuthModule {}
