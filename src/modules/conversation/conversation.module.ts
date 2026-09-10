import { Module } from '@nestjs/common';
import { ConversationService } from './conversation.service.js';
import { StateStore } from './state.store.js';
import { NluModule } from '../nlu/nlu.module.js';
import { ResolverModule } from '../resolver/resolver.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { WalletModule } from '../wallet/wallet.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PaymentsModule } from '../payments/payments.module.js';

@Module({
  imports: [NluModule, ResolverModule, IdentityModule, WalletModule, AuthModule, PaymentsModule],
  providers: [ConversationService, StateStore],
  exports: [ConversationService],
})
export class ConversationModule {}
