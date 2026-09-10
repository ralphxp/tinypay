export type ChannelName = 'telegram_dm' | 'telegram_group' | 'whatsapp_dm';

/**
 * FSM session — transient and non-authoritative for money (guiding
 * principle #1). Losing this loses only the in-progress conversation; no
 * committed money is ever represented here, only slot data feeding into a
 * later ledger call made by a later slice.
 */
export interface Session {
  flow: string | null;
  step: string | null;
  slots: Record<string, unknown>;
  attempts: number;
  /** Optimistic-concurrency version — bumped by StateStore.save() on every write. */
  v: number;
  createdAt: number;
  updatedAt: number;
  /** Step ids visited in the current flow, oldest first — powers the `back` interrupt. */
  history: string[];
}

/** A single inbound turn: either a global interrupt or a step-directed event. */
export interface InboundEvent {
  userId: string;
  channel: ChannelName;
  /** 'cancel' | 'menu' | 'back' | 'help' short-circuit step routing; anything else routes to the current step. */
  kind: string;
  /** Free-form payload the current StepDef's validate() knows how to read (e.g. NLU output, PIN digits). */
  payload?: Record<string, unknown>;
}

/** Channel-agnostic reply — rendering/sending into a real channel is a later slice. */
export interface OutboundMessage {
  text: string;
  choices?: string[];
}

export interface StepDef {
  /** Validates the event against the current step; throws StepError to re-prompt. Returns slots to merge. */
  validate(
    evt: InboundEvent,
    session: Session,
  ): Promise<{ slots?: Record<string, unknown> }> | { slots?: Record<string, unknown> };
  /** Decides the next step id from the (already slot-merged) session. May run side effects (e.g. call a port). */
  next(session: Session): Promise<string> | string;
  /** Message shown when this step is (re-)entered, or re-prompted after a StepError. */
  prompt(session: Session): OutboundMessage;
  /** Caps StepError re-prompts on this step (e.g. PIN attempts) — omit for no cap. */
  maxAttempts?: number;
  /**
   * True for a step whose validate()/next() don't need real user input (a
   * port call driving the machine forward, e.g. resolve_recipient,
   * executing). advance() chains straight through these within one turn
   * instead of stopping to prompt and wait.
   */
  auto?: boolean;
}

export interface FlowDef {
  /** The step a fresh entry into this flow starts at. */
  entry: string;
  /** Terminal step ids — reaching one of these ends the flow (advance() returns to idle after). */
  terminal: string[];
  steps: Record<string, StepDef>;
}
