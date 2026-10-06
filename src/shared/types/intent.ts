/** Closed set the grammar must resolve every utterance into — nothing
 * outside this enum ever reaches the FSM. help/cancel/menu/back are global
 * interrupts (InvocationGate.matchInterrupt), not grammar intents. */
export type Intent = 'fund' | 'balance' | 'history' | 'airtime' | 'data' | 'unknown';

export type NetworkName = 'mtn' | 'glo' | 'airtel' | 'nine_mobile';
