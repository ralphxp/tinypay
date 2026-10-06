import { Injectable, Logger } from '@nestjs/common';
import { StateStore } from './state.store.js';
import { FlowRegistry, FLOW_START_KINDS, type FlowName } from './flow.registry.js';
import { InvocationGate, matchInterrupt } from './invocation.gate.js';
import { NluService } from '../nlu/nlu.service.js';
import type { Nlu } from '../nlu/nlu.schema.js';
import { parseAmountMinor, normalizeNetwork } from '../nlu/normalizer.js';
import { EnrollmentGuard } from '../identity/enrollment.guard.js';
import { WalletService } from '../wallet/wallet.service.js';
import { formatNaira } from '../../shared/utils/format-money.js';
import { normalizePhone } from '../../shared/utils/phone.js';
import { StepError } from '../../common/errors/domain-errors.js';
import type { Surface } from '../../shared/types/surface.js';
import type {
  ChannelName,
  FlowDef,
  HandleTextInput,
  InboundEvent,
  OutboundMessage,
  Session,
  StepDef,
} from './types.js';

/** Sender resolved to a real userId + phone (post-EnrollmentGuard) — what every step past the front gate operates on. */
interface ResolvedContext {
  userId: string;
  phone: string;
  channel: ChannelName;
  surface: Surface;
  groupId?: string;
}

const LOCK_TTL_MS = 10_000;

const MENU_TEXT =
  "Here's what I can do:\n• fund — top up your wallet\n• airtime — buy airtime\n• data — buy a data bundle\n• balance — check your wallet\n• history — recent transactions";
const HELP_TEXT = "Say 'fund', 'airtime', 'data', or 'balance'. You can 'cancel' or go 'back' at any point.";
const NOTHING_TO_CANCEL_TEXT = 'Nothing in progress to cancel.';
const NOTHING_TO_GO_BACK_TO_TEXT = "There's nothing to go back to.";
const IDLE_FALLBACK_TEXT = "I didn't catch that. Say 'fund', 'airtime', 'data', or 'balance'.";
const TOO_MANY_ATTEMPTS_TEXT = 'Too many failed attempts — cancelled. Please start again.';

function sessionKey(evt: { userId: string; channel: string }): string {
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
    private readonly gate: InvocationGate,
    private readonly nlu: NluService,
    private readonly enrollmentGuard: EnrollmentGuard,
    private readonly wallet: WalletService,
  ) {}

  /**
   * The FSM turn loop. Returns undefined when the message was dropped
   * (lock not acquired, or a lost optimistic-version race) — the session is
   * transient and non-authoritative, so a dropped turn never loses money,
   * only a conversational step the user can just retry.
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

  /**
   * Real entry point for a channel message: EnrollmentGuard -> InvocationGate
   * -> (idle: NLU intent dispatch) | (mid-flow: route straight into the
   * active step, letting its own validate() interpret the raw text — most
   * steps also accept a tap's `value`, via flows/flow-input.ts).
   *
   * EnrollmentGuard runs first and can throw NotEnrolledError — that's
   * intentional and propagates to the caller uncaught: this method never
   * sends the onboarding hand-off itself, the channel layer does (see
   * NotEnrolledError.handoff).
   *
   * Returns undefined when the gate ignores the message (not addressed, or
   * a global interrupt matched but the lock/version race was lost) — same
   * "dropped, no reply" contract as advance() uses elsewhere.
   */
  async handleText(input: HandleTextInput): Promise<OutboundMessage | undefined> {
    const user = await this.enrollmentGuard.checkEnrollment(input.senderPhone);
    const ctx: ResolvedContext = {
      userId: user.id,
      phone: user.phone,
      channel: input.channel,
      surface: input.surface,
      groupId: input.groupId,
    };

    const key = sessionKey(ctx);
    const peeked = await this.stateStore.load(key);
    const isActiveFlow = peeked?.flow != null;

    const gateResult = this.gate.check({ surface: input.surface, isActiveFlow, text: input.text });
    if (!gateResult.addressed) return undefined;

    const utterance = gateResult.utterance;
    const interrupt = matchInterrupt(utterance);
    if (interrupt) {
      return this.advance({ userId: ctx.userId, channel: ctx.channel, kind: interrupt });
    }

    if (isActiveFlow) {
      // Free text aimed at whatever step is currently active — the step's
      // own validate() parses it (see flows/flow-input.ts's inputText()),
      // not whole-intent grammar, which a bare "500" or "mtn" would never match.
      return this.advance({ userId: ctx.userId, channel: ctx.channel, kind: 'input', payload: { text: utterance } });
    }

    const nlu = await this.nlu.parse(utterance);
    switch (nlu.intent) {
      case 'balance':
        return this.handleBalanceQuery(ctx);
      case 'history':
        return this.handleHistoryQuery(ctx);
      case 'fund':
        return this.handleFundIntent(key, ctx, nlu);
      case 'airtime':
        return this.handleAirtimeIntent(key, ctx, nlu);
      case 'data':
        return this.handleDataIntent(key, ctx, nlu);
      case 'unknown':
      default:
        return { text: IDLE_FALLBACK_TEXT };
    }
  }

  private async handleBalanceQuery(ctx: ResolvedContext): Promise<OutboundMessage> {
    const balance = await this.wallet.getBalance(ctx.userId);
    return { text: `Your wallet balance is ${formatNaira(balance)}.` };
  }

  private async handleHistoryQuery(ctx: ResolvedContext): Promise<OutboundMessage> {
    const transactions = await this.wallet.listTransactions(ctx.userId, 10);
    if (transactions.length === 0) {
      return { text: 'No transactions yet.' };
    }
    const lines = transactions.map((t) => {
      const sign = t.type === 'fund' ? '+' : '-';
      const label = t.type === 'fund' ? 'Funded' : t.type === 'airtime' ? 'Airtime' : 'Data';
      return `${sign}${formatNaira(t.amountMinor)} ${label} (${t.status})`;
    });
    return { text: ['Recent transactions:', ...lines].join('\n') };
  }

  private handleFundIntent(key: string, ctx: ResolvedContext, nlu: Nlu): Promise<OutboundMessage | undefined> {
    const prefilled: Record<string, unknown> = { userId: ctx.userId };
    if (nlu.entities.amountRaw) {
      try {
        prefilled.amountMinor = parseAmountMinor(nlu.entities.amountRaw).toString();
      } catch (err) {
        if (err instanceof StepError) return Promise.resolve({ text: err.message });
        throw err;
      }
    }
    return this.seedFlow(key, 'fund', prefilled);
  }

  private handleAirtimeIntent(key: string, ctx: ResolvedContext, nlu: Nlu): Promise<OutboundMessage | undefined> {
    // selfPhone is the await_recipient_phone step's 'Myself' default — can
    // buy for someone else too, when the message names a phone directly.
    const prefilled: Record<string, unknown> = { userId: ctx.userId, selfPhone: ctx.phone };
    if (nlu.entities.phoneRaw) {
      prefilled.recipientPhone = normalizePhone(nlu.entities.phoneRaw);
    }
    if (nlu.entities.networkRaw) {
      try {
        prefilled.network = normalizeNetwork(nlu.entities.networkRaw);
      } catch (err) {
        if (err instanceof StepError) return Promise.resolve({ text: err.message });
        throw err;
      }
    }
    if (nlu.entities.amountRaw) {
      try {
        prefilled.amountMinor = parseAmountMinor(nlu.entities.amountRaw).toString();
      } catch (err) {
        if (err instanceof StepError) return Promise.resolve({ text: err.message });
        throw err;
      }
    }
    return this.seedFlow(key, 'airtime', prefilled);
  }

  private handleDataIntent(key: string, ctx: ResolvedContext, nlu: Nlu): Promise<OutboundMessage | undefined> {
    const prefilled: Record<string, unknown> = { userId: ctx.userId, selfPhone: ctx.phone };
    if (nlu.entities.phoneRaw) {
      prefilled.recipientPhone = normalizePhone(nlu.entities.phoneRaw);
    }
    if (nlu.entities.networkRaw) {
      try {
        prefilled.network = normalizeNetwork(nlu.entities.networkRaw);
      } catch (err) {
        if (err instanceof StepError) return Promise.resolve({ text: err.message });
        throw err;
      }
    }
    return this.seedFlow(key, 'data', prefilled);
  }

  /**
   * Seed & jump: maps already-normalized slots straight into a fresh
   * session and walks the flow from its entry step, skipping any step
   * whose slot is already known, until it lands on the first step that
   * still needs real input.
   */
  private async seedFlow(
    key: string,
    flowName: FlowName,
    prefilled: Record<string, unknown>,
  ): Promise<OutboundMessage | undefined> {
    const token = await this.stateStore.acquire(key, LOCK_TTL_MS);
    if (!token) return undefined;

    try {
      const loaded = await this.stateStore.load(key);
      const loadedVersion = loaded?.v ?? 0;

      const flowDef = this.registry.get(flowName);
      const targetStepId = this.computeEntryStep(flowDef, prefilled);
      // Every slot a slotStep fills is already known (targetStepId is null)
      // — there's no step left to stop and prompt for, so the loop below
      // treats every slotStep as pass-through (run next(), never prompt)
      // instead of comparing against a (nonexistent) specific target id.
      const slotStepIds = new Set(flowDef.slotSteps.map((s) => s.step));

      let session: Session = { ...this.stateStore.fresh(), flow: flowName, slots: prefilled };
      let stepId = flowDef.entry;

      for (;;) {
        const stepDef = flowDef.steps[stepId]!;
        const isTarget = targetStepId !== null ? stepId === targetStepId : !slotStepIds.has(stepId);

        if (isTarget && !stepDef.auto) {
          session = { ...session, step: stepId };
          const saved = await this.stateStore.save(key, session, loadedVersion);
          if (!saved) return undefined;
          return stepDef.prompt(session);
        }

        let nextStepId: string;
        try {
          nextStepId = await stepDef.next(session);
        } catch (err) {
          if (err instanceof StepError) {
            const entrySession: Session = { ...this.stateStore.fresh(), flow: flowName, step: flowDef.entry };
            const saved = await this.stateStore.save(key, entrySession, loadedVersion);
            if (!saved) return undefined;
            return { text: err.message };
          }
          throw err;
        }

        if (flowDef.terminal.includes(nextStepId)) {
          const terminalStepDef = flowDef.steps[nextStepId]!;
          const message = terminalStepDef.prompt(session);
          const saved = await this.stateStore.save(key, idleSlate(session), loadedVersion);
          if (!saved) return undefined;
          return message;
        }

        session = { ...session, step: nextStepId, history: [...session.history, stepId] };
        stepId = nextStepId;
      }
    } finally {
      await this.stateStore.release(key, token);
    }
  }

  /** First slotStep whose slot isn't already prefilled — flowDef.entry if every listed slot is known. */
  /** First slotStep whose slot isn't already prefilled, or null if every listed slot is known. */
  private computeEntryStep(flowDef: FlowDef, prefilled: Record<string, unknown>): string | null {
    for (const { step, slot } of flowDef.slotSteps) {
      if (!(slot in prefilled)) return step;
    }
    return null;
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
    const entryStepId = session.step!;
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

      let nextStepId: string;
      try {
        nextStepId = await stepDef.next(working);
      } catch (err) {
        if (err instanceof StepError) {
          return this.handleStepError(key, session, loadedVersion, flowDef.steps[entryStepId]!, err);
        }
        throw err;
      }

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
