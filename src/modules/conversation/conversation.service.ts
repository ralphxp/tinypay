import { Injectable, Logger } from '@nestjs/common';
import { StateStore } from './state.store.js';
import { FlowRegistry, FLOW_START_KINDS } from './flow.registry.js';
import { StepError } from '../../common/errors/domain-errors.js';
import type { InboundEvent, OutboundMessage, Session, StepDef } from './types.js';

const LOCK_TTL_MS = 10_000;

const MENU_TEXT = "Here's what I can do:\n• transfer — send money to someone";
const HELP_TEXT = "Say 'transfer' to send money. You can 'cancel' or go 'back' at any point.";
const NOTHING_TO_CANCEL_TEXT = 'Nothing in progress to cancel.';
const NOTHING_TO_GO_BACK_TO_TEXT = "There's nothing to go back to.";
const IDLE_FALLBACK_TEXT = "I didn't catch that. Say 'transfer' to send money.";
const TOO_MANY_ATTEMPTS_TEXT = 'Too many failed attempts — cancelled. Please start again.';

function sessionKey(evt: InboundEvent): string {
  return `fsm:${evt.userId}:${evt.channel}`;
}

function idleSlate(session: Session): Session {
  return { ...session, flow: null, step: null, slots: {}, attempts: 0, history: [] };
}

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    private readonly stateStore: StateStore,
    private readonly registry: FlowRegistry,
  ) {}

  /**
   * The FSM turn loop. Returns undefined when the message was dropped
   * (lock not acquired, or a lost optimistic-version race) — per guiding
   * principle #1 the session is transient and non-authoritative, so a
   * dropped turn never loses money, only a conversational step the user can
   * just retry.
   */
  async advance(evt: InboundEvent): Promise<OutboundMessage | undefined> {
    const key = sessionKey(evt);
    const token = await this.stateStore.acquire(key, LOCK_TTL_MS);
    if (!token) return undefined; // racing message dropped; the first holder replies

    try {
      const loaded = await this.stateStore.load(key);
      const loadedVersion = loaded?.v ?? 0;
      const session = loaded ?? this.stateStore.fresh();

      if (evt.kind === 'help') {
        // Non-destructive: doesn't touch session state, nothing to save.
        return { text: HELP_TEXT };
      }
      if (evt.kind === 'cancel') {
        return this.handleCancel(key, session, loadedVersion);
      }
      if (evt.kind === 'menu') {
        return this.handleMenu(key, session, loadedVersion);
      }
      if (evt.kind === 'back') {
        return this.handleBack(key, session, loadedVersion);
      }

      if (!session.flow) {
        return this.handleFlowStart(key, evt, session, loadedVersion);
      }

      return this.routeToStep(key, evt, session, loadedVersion);
    } finally {
      await this.stateStore.release(key, token);
    }
  }

  private async handleCancel(
    key: string,
    session: Session,
    loadedVersion: number,
  ): Promise<OutboundMessage | undefined> {
    if (!session.flow) return { text: NOTHING_TO_CANCEL_TEXT };
    const saved = await this.stateStore.save(key, idleSlate(session), loadedVersion);
    if (!saved) return undefined;
    return { text: 'Cancelled.' };
  }

  private async handleMenu(
    key: string,
    session: Session,
    loadedVersion: number,
  ): Promise<OutboundMessage | undefined> {
    if (!session.flow) return { text: MENU_TEXT };
    const saved = await this.stateStore.save(key, idleSlate(session), loadedVersion);
    if (!saved) return undefined;
    return { text: MENU_TEXT };
  }

  private async handleBack(
    key: string,
    session: Session,
    loadedVersion: number,
  ): Promise<OutboundMessage | undefined> {
    if (!session.flow || session.history.length === 0) {
      return { text: NOTHING_TO_GO_BACK_TO_TEXT };
    }
    const prevStepId = session.history[session.history.length - 1]!;
    const nextSession: Session = { ...session, step: prevStepId, history: session.history.slice(0, -1) };
    const saved = await this.stateStore.save(key, nextSession, loadedVersion);
    if (!saved) return undefined;
    const stepDef = this.registry.get(session.flow).steps[prevStepId]!;
    return stepDef.prompt(nextSession);
  }

  private async handleFlowStart(
    key: string,
    evt: InboundEvent,
    session: Session,
    loadedVersion: number,
  ): Promise<OutboundMessage | undefined> {
    const flowName = FLOW_START_KINDS[evt.kind];
    if (!flowName) return { text: IDLE_FALLBACK_TEXT };

    const flowDef = this.registry.get(flowName);
    const nextSession: Session = {
      ...session,
      flow: flowName,
      step: flowDef.entry,
      slots: {},
      attempts: 0,
      history: [],
    };
    const saved = await this.stateStore.save(key, nextSession, loadedVersion);
    if (!saved) return undefined;
    return flowDef.steps[flowDef.entry]!.prompt(nextSession);
  }

  /**
   * Runs the current step, then chains through any `auto` steps within this
   * same turn (they need no real user input — see StepDef.auto), stopping
   * at the first step that does need input, or at a terminal step.
   */
  private async routeToStep(
    key: string,
    evt: InboundEvent,
    session: Session,
    loadedVersion: number,
  ): Promise<OutboundMessage | undefined> {
    const flowDef = this.registry.get(session.flow!);
    let working: Session = session;
    let stepId = session.step!;
    let stepDef: StepDef = flowDef.steps[stepId]!;
    let currentEvt = evt;

    for (;;) {
      let mergedSlots: Record<string, unknown>;
      try {
        const { slots } = await stepDef.validate(currentEvt, working);
        mergedSlots = { ...working.slots, ...slots };
      } catch (err) {
        if (err instanceof StepError) {
          return this.handleStepError(key, working, loadedVersion, stepDef, err);
        }
        throw err;
      }

      working = { ...working, slots: mergedSlots, attempts: 0 };
      const nextStepId = await stepDef.next(working);

      if (flowDef.terminal.includes(nextStepId)) {
        const terminalStepDef = flowDef.steps[nextStepId]!;
        const message = terminalStepDef.prompt(working);
        const saved = await this.stateStore.save(key, idleSlate(working), loadedVersion);
        if (!saved) return undefined;
        return message;
      }

      const nextStepDef = flowDef.steps[nextStepId]!;
      working = { ...working, step: nextStepId, history: [...working.history, stepId] };

      if (!nextStepDef.auto) {
        const saved = await this.stateStore.save(key, working, loadedVersion);
        if (!saved) return undefined;
        return nextStepDef.prompt(working);
      }

      stepId = nextStepId;
      stepDef = nextStepDef;
      currentEvt = { userId: evt.userId, channel: evt.channel, kind: 'auto' };
    }
  }

  private async handleStepError(
    key: string,
    session: Session,
    loadedVersion: number,
    stepDef: StepDef,
    err: StepError,
  ): Promise<OutboundMessage | undefined> {
    const attempts = session.attempts + 1;

    if (stepDef.maxAttempts !== undefined && attempts >= stepDef.maxAttempts) {
      const saved = await this.stateStore.save(key, idleSlate(session), loadedVersion);
      if (!saved) return undefined;
      return { text: TOO_MANY_ATTEMPTS_TEXT };
    }

    const retrySession: Session = { ...session, attempts };
    const saved = await this.stateStore.save(key, retrySession, loadedVersion);
    if (!saved) return undefined;
    this.logger.debug(`StepError on ${session.flow}/${session.step}: ${err.message}`);
    return { text: err.message };
  }
}
