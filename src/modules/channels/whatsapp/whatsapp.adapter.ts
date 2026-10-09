import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../../config/config.service.js';
import { UserService } from '../../identity/user.service.js';
import { ConversationService } from '../../conversation/conversation.service.js';
import { StateStore } from '../../conversation/state.store.js';
import { FlowRegistry } from '../../conversation/flow.registry.js';
import type { ChannelName } from '../../conversation/types.js';
import { normalizePhone } from '../../../shared/utils/phone.js';
import type { OutboundMessage } from '../../../shared/types/outbound-message.js';
import type { ChannelPort } from '../channel.port.js';
import { TwilioClient } from './twilio-client.js';
import { renderForWhatsApp } from './render-whatsapp.js';

/** Twilio's WhatsApp "To"/"From" fields are "whatsapp:+234..." — strip the prefix to get a bare phone. */
function stripWhatsAppPrefix(value: string): string {
  return value.replace(/^whatsapp:/i, '');
}

/**
 * The WhatsApp implementation of ChannelPort, via Twilio as the BSP (not
 * Meta's own Cloud API directly — see TwilioClient's docstring). Simpler
 * than Telegram in one respect and more limited in another:
 *
 * - No separate enrollment/contact-share dance: Twilio's `From` field for a
 *   WhatsApp message already IS the sender's verified phone number (WhatsApp
 *   itself owns that verification), so there's no "map a chat-native id to a
 *   phone" step the way Telegram needs one — see handleIncoming, which
 *   enrolls (findOrCreateByPhone) directly rather than going through
 *   EnrollmentGuard's NotEnrolledError hand-off path.
 * - No native tappable buttons: Twilio's sandbox doesn't support interactive
 *   reply buttons without pre-approved content templates, so every choice is
 *   rendered as a numbered plain-text line (render-whatsapp.ts) and every
 *   reply is free text — including a bare number, which resolveReplyText
 *   below translates back to the actual slot value by re-deriving the
 *   current step's choices from session state (the same thing
 *   TelegramAdapter's deliverReply does to encode callback_data, just used
 *   the other direction here).
 */
@Injectable()
export class WhatsAppAdapter implements ChannelPort {
  readonly supportsGroupSurface = false;

  constructor(
    private readonly config: ConfigService,
    private readonly users: UserService,
    private readonly conversation: ConversationService,
    private readonly stateStore: StateStore,
    private readonly registry: FlowRegistry,
    private readonly twilio: TwilioClient,
  ) {}

  // ---- ChannelPort ----

  async send(to: string, message: OutboundMessage): Promise<void> {
    const user = await this.users.findById(to);
    if (!user) return;
    await this.sendToPhone(user.phone, message);
  }

  async fanOutToMembers(userIds: string[], message: OutboundMessage): Promise<void> {
    await Promise.all(userIds.map((userId) => this.send(userId, message)));
  }

  generateInviteLink(): Promise<string> {
    throw new Error('generateInviteLink is not implemented — WhatsApp has no group surface in this build.');
  }

  // ---- Inbound ----

  /** Entry point for the webhook controller — Twilio's parsed form params for one incoming message. */
  async handleIncoming(params: Record<string, string>): Promise<void> {
    const from = params.From;
    const body = params.Body;
    if (!from || body === undefined) return;

    const phone = normalizePhone(stripWhatsAppPrefix(from));
    // Twilio has already verified this sender controls this WhatsApp number —
    // unlike Telegram's bare numeric id, there's nothing to separately link.
    const user = await this.users.findOrCreateByPhone(phone);

    const channel: ChannelName = 'whatsapp_dm';
    const resolvedText = await this.resolveNumberedReply(user.id, channel, body);

    const reply = await this.conversation.handleText({
      senderPhone: phone,
      channel,
      surface: channel,
      text: resolvedText,
    });
    if (!reply) return;
    await this.sendToPhone(phone, reply);
  }

  /**
   * If `rawText` is a bare number ("1", "2", ...) and the current session's
   * active step rendered that many choices, returns the underlying value for
   * that position (same value a Telegram tap would have sent) — otherwise
   * returns `rawText` unchanged, so ordinary free text (an amount, a phone
   * number, "cancel", ...) passes straight through.
   */
  private async resolveNumberedReply(userId: string, channel: ChannelName, rawText: string): Promise<string> {
    const trimmed = rawText.trim();
    const index = Number(trimmed);
    if (!Number.isInteger(index) || index < 1) return rawText;

    const session = await this.stateStore.load(`fsm:${userId}:${channel}`);
    if (!session?.flow || !session.step) return rawText;

    const stepDef = this.registry.get(session.flow).steps[session.step];
    const choice = stepDef?.prompt(session).choices?.[index - 1];
    if (!choice) return rawText;
    return typeof choice === 'string' ? choice : choice.value;
  }

  private async sendToPhone(phone: string, message: OutboundMessage): Promise<void> {
    const from = this.config.get('TWILIO_WHATSAPP_NUMBER');
    if (!from) return;
    const text = renderForWhatsApp(message);
    await this.twilio.sendWhatsAppMessage(`whatsapp:${phone}`, from, text);
  }
}
