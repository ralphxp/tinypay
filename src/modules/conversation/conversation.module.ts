import { Module } from '@nestjs/common';
import { ConversationService } from './conversation.service.js';
import { CommandHandlerService } from './command-handler.service.js';
import { StateStore } from './state.store.js';
import { FlowRegistry } from './flow.registry.js';
import { RECIPIENT_RESOLVER_PORT, StubRecipientResolver } from './ports/recipient-resolver.port.js';
import { EXECUTOR_PORT, StubExecutor } from './ports/executor.port.js';
import { NluModule } from '../nlu/nlu.module.js';
import { ResolverModule } from '../resolver/resolver.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { WalletModule } from '../wallet/wallet.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PaymentsModule } from '../payments/payments.module.js';

@Module({
  imports: [NluModule, ResolverModule, IdentityModule, WalletModule, AuthModule, PaymentsModule],
  providers: [
    // Existing direct-response command handler (balance/fund/transfer/withdraw
    // via auth-links) — real module wiring, predates and is out of scope for
    // Slice 2's FSM.
    CommandHandlerService,
    // Slice 2: the stateful multi-turn FSM. Port implementations are stubs —
    // see ports/ — real Paystack/ledger wiring lands in a later slice.
    ConversationService,
    StateStore,
    FlowRegistry,
    { provide: RECIPIENT_RESOLVER_PORT, useClass: StubRecipientResolver },
    { provide: EXECUTOR_PORT, useClass: StubExecutor },
  ],
  exports: [CommandHandlerService, ConversationService, StateStore],
})
export class ConversationModule {}
