import type { OutboundMessage } from '../../shared/types/outbound-message.js';
import type { ChannelName } from '../conversation/types.js';

/**
 * A channel-native inbound update, normalized to the common shape the
 * pipeline (EnrollmentGuard -> InvocationGate -> NLU -> resolver -> FSM)
 * operates on. `userId` is set only once the channel has already resolved
 * its native sender id to a known TinyPay user (see ChannelPort docs below)
 * — an unresolved sender carries neither `userId` nor `senderPhone`, and the
 * adapter is responsible for handing that case off to onboarding itself,
 * never guessing an identity or inventing a second account keyed on the
 * channel-native id.
 */
export interface ChannelInboundEvent {
  userId?: string;
  senderPhone?: string;
  channel: ChannelName;
  /** Channel-native destination for a direct reply to this update (e.g. a Telegram chat id). */
  chatRef: string;
  text: string;
  mentionsBot: boolean;
  isGroup: boolean;
  groupId?: string;
  /** Present when this event is a pre-resolved tap (an inline-keyboard callback), not free text. */
  structured?: { flow: string; step: string; value: string };
}

/**
 * The one seam core code is allowed to depend on for chat I/O — no core
 * module may import a channel SDK (grammy, twilio, ...) directly, only this
 * interface. A channel adapter (TelegramAdapter; a future WhatsAppAdapter)
 * implements it and owns all rendering, inbound normalization, and identity
 * resolution for its own transport.
 */
export interface ChannelPort {
  readonly supportsGroupSurface: boolean;
  /** Sends a rendered OutboundMessage to a TinyPay user — the adapter resolves
   * `to` (a userId) to its own channel-native destination internally. */
  send(to: string, message: OutboundMessage): Promise<void>;
  fanOutToMembers(userIds: string[], message: OutboundMessage): Promise<void>;
  /** P3 (group-finance saga) scope — every adapter must implement the method,
   * but pooled-group invites are not built this slice. */
  generateInviteLink(groupId: string): Promise<string>;
}
