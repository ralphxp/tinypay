import { Module } from '@nestjs/common';
import { ConversationService } from './conversation.service.js';
import { StateStore } from './state.store.js';
import { FlowRegistry } from './flow.registry.js';
import { InvocationGate } from './invocation.gate.js';
import { NluModule } from '../nlu/nlu.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { WalletModule } from '../wallet/wallet.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  imports: [NluModule, IdentityModule, WalletModule, PaymentsModule, NotificationsModule],
  providers: [ConversationService, StateStore, FlowRegistry, InvocationGate],
  // FlowRegistry is exported for WhatsAppAdapter, which (unlike Telegram's
  // inline keyboards) has to re-derive a step's choices itself to translate
  // a numbered text reply back into the tapped value — see its docstring.
  exports: [ConversationService, StateStore, FlowRegistry],
})
export class ConversationModule {}
