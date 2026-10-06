import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Bot } from 'grammy';
import type { Update } from 'grammy/types';
import { ConfigService } from '../../../config/config.service.js';
import { UserService } from '../../identity/user.service.js';
import { ConversationService } from '../../conversation/conversation.service.js';
import { StateStore } from '../../conversation/state.store.js';
import type { ChannelName } from '../../conversation/types.js';
import { normalizePhone } from '../../../shared/utils/phone.js';
import type { OutboundMessage } from '../../../shared/types/outbound-message.js';
import type { ChannelPort } from '../channel.port.js';
import { TELEGRAM_BOT } from './telegram-bot.provider.js';
import { TelegramSenderService } from './telegram-sender.service.js';
import { renderForTelegram } from './render-outbound.js';
import { normalizeUpdate } from './normalize-update.js';

const CONTACT_REQUEST_PROMPT = 'Welcome to TinyPay! Please share your phone number to get started.';

/**
 * The Telegram implementation of ChannelPort: inbound webhook updates ->
 * EnrollmentGuard/InvocationGate/NLU/resolver/FSM (via ConversationService)
 * -> rendered, masked, keyboard-bearing replies back out. This is the only
 * file in the codebase allowed to import `grammy` for anything beyond the
 * shared Bot instance/sender (see telegram-core.module.ts) — see
 * test/channels/port-isolation.spec.ts for the structural grep proving it.
 *
 * Identity seam (must never leak): a Telegram user id is never treated as a
 * wallet key. It only ever resolves to a canonical phone-keyed User via
 * UserService.findByTelegramUserId — an unmapped id is always "not
 * enrolled", handed off to the contact-share prompt below, never silently
 * given a second account.
 *
 * Privacy mode (deliberate, documented choice): BotFather's own Group
 * Privacy setting should stay ENABLED for this bot (its default) — Telegram
 * then never delivers ordinary group chatter to the webhook at all, only
 * commands/mentions/replies. That alone isn't relied on as the enforcement
 * boundary, though: handleTextMessage below re-checks addressing itself
 * (wake-word or @mention) before doing anything else for a group message,
 * so behavior is correct even if a group admin disables privacy mode later
 * or the bot is promoted to admin (which bypasses privacy mode entirely).
 */
@Injectable()
export class TelegramAdapter implements ChannelPort, OnModuleInit {
  readonly supportsGroupSurface = true;
  private readonly logger = new Logger(TelegramAdapter.name);

  constructor(
    @Inject(TELEGRAM_BOT) private readonly bot: Bot | undefined,
    private readonly config: ConfigService,
    private readonly users: UserService,
    private readonly conversation: ConversationService,
    private readonly stateStore: StateStore,
    private readonly sender: TelegramSenderService,
  ) {}

  /**
   * Registers this bot's webhook URL with Telegram — a no-op when the bot
   * isn't configured (tests, local dev without a token) or when the app
   * isn't reachable yet (APP_BASE_URL unset). Idempotent: safe to call on
   * every boot, including every replica in a multi-instance deployment.
   */
  async onModuleInit(): Promise<void> {
    if (!this.bot) return;
    const secret = this.config.get('TELEGRAM_WEBHOOK_SECRET');
    const base = this.config.get('APP_BASE_URL');
    if (!secret || !base) {
      this.logger.warn('TELEGRAM_WEBHOOK_SECRET or APP_BASE_URL not set — skipping setWebhook');
      return;
    }
    try {
      const url = new URL('/webhooks/telegram', base).toString();
      await this.bot.api.setWebhook(url, { secret_token: secret });
    } catch (err) {
      this.logger.error('Failed to register Telegram webhook', err instanceof Error ? err.stack : err);
    }
  }

  // ---- ChannelPort ----

  send(to: string, message: OutboundMessage): Promise<void> {
    return this.sender.sendToUser(to, message);
  }

  async fanOutToMembers(userIds: string[], message: OutboundMessage): Promise<void> {
    await Promise.all(userIds.map((userId) => this.sender.sendToUser(userId, message)));
  }

  generateInviteLink(): Promise<string> {
    // Pooled-group invites are P3 (group-finance saga) scope — not built
    // this slice. supportsGroupSurface=true only covers basic addressing.
    throw new Error('generateInviteLink is not implemented — group invites are P3 scope.');
  }

  // ---- Inbound ----

  /** Entry point for the webhook controller — one raw Telegram Update per call. */
  async handleUpdate(update: Update): Promise<void> {
    if (!this.bot) return;

    if (update.message?.contact) {
      await this.handleContactShare(update);
      return;
    }
    if (update.callback_query) {
      await this.handleCallbackQuery(update);
      return;
    }
    if (update.message?.text) {
      await this.handleTextMessage(update);
      return;
    }
    // Unhandled update type (edited message, sticker, ...) — ignored.
  }

  private botUsername(): string {
    // bot.botInfo throws if bot.init() hasn't completed (see
    // TelegramBotInitializer) — isInited() is the safe way to check first.
    if (!this.bot?.isInited()) return '';
    return this.bot.botInfo.username;
  }

  private async handleContactShare(update: Update): Promise<void> {
    const message = update.message!;
    const contact = message.contact!;
    if (!message.from) return;

    // Only accept the sender's own contact card — never one forwarded from
    // someone else, which would let a user link a phone that isn't theirs.
    if (contact.user_id !== message.from.id) {
      await this.bot!.api.sendMessage(message.chat.id, "Please share your own contact, not someone else's.");
      return;
    }

    const phone = normalizePhone(contact.phone_number);
    const user = await this.users.findOrCreateByPhone(phone);
    await this.users.linkTelegramUserId(user.id, String(message.from.id));
    await this.bot!.api.sendMessage(message.chat.id, "You're all set. Try 'tinypay balance'.", {
      reply_markup: { remove_keyboard: true },
    });
  }

  private async handleTextMessage(update: Update): Promise<void> {
    const draft = normalizeUpdate(update, this.botUsername());
    if (!draft || !draft.telegramUserId) return;

    // Privacy mode (deliberate choice — see class docstring below): a group
    // message that doesn't address the bot is dropped before any lookup at
    // all, so a busy group's ordinary chatter never triggers an enrollment
    // check or an onboarding DM to a random member who never said "tinypay".
    if (draft.isGroup && !draft.mentionsBot) return;

    const user = await this.users.findByTelegramUserId(draft.telegramUserId);
    if (!user) {
      if (draft.isGroup) {
        await this.bot!.api.sendMessage(draft.chatRef, 'Please DM me directly to link your TinyPay account.');
      } else {
        await this.promptForContact(draft.chatRef);
      }
      return;
    }

    const reply = await this.conversation.handleText({
      senderPhone: user.phone,
      channel: draft.channel,
      surface: draft.channel,
      text: update.message!.text!,
      groupId: draft.groupId,
    });
    if (!reply) return; // gate dropped it (unaddressed group chatter, or idle DM without the wake word)
    await this.deliverReply(user.id, draft.channel, draft.chatRef, reply);
  }

  private async handleCallbackQuery(update: Update): Promise<void> {
    const cq = update.callback_query!;
    const draft = normalizeUpdate(update, this.botUsername());

    if (!draft?.telegramUserId) {
      await this.bot!.api.answerCallbackQuery(cq.id);
      return;
    }

    const user = await this.users.findByTelegramUserId(draft.telegramUserId);
    if (!user) {
      await this.bot!.api.answerCallbackQuery(cq.id, { text: 'Please DM me to get started.', show_alert: true });
      return;
    }

    await this.bot!.api.answerCallbackQuery(cq.id);
    if (!draft.structured) return;

    const { value } = draft.structured;
    const isCancel = value === 'cancel';
    const reply = await this.conversation.advance(
      isCancel
        ? { userId: user.id, channel: draft.channel, kind: 'cancel' }
        : { userId: user.id, channel: draft.channel, kind: 'input', payload: { value } },
    );
    if (reply) await this.deliverReply(user.id, draft.channel, draft.chatRef, reply);
  }

  private async promptForContact(chatRef: string): Promise<void> {
    await this.bot!.api.sendMessage(chatRef, CONTACT_REQUEST_PROMPT, {
      reply_markup: {
        keyboard: [[{ text: 'Share phone number', request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    });
  }

  /**
   * Sends a reply within an ongoing conversation back to the chat it came
   * from — the originating `chatRef`, not the user's DM. This matters for
   * groups: a group reply must land back in the group, never redirect to
   * the user's private chat (that's what TelegramSenderService.sendToUser,
   * a userId-addressed send, would do — the wrong thing here). Re-derives
   * the just-saved session's flow/step (if any) so a choice-bearing reply's
   * inline-keyboard buttons carry the right callback_data (see
   * callback-codec.ts) — the FSM's OutboundMessage itself carries no flow/step.
   */
  private async deliverReply(userId: string, channel: ChannelName, chatRef: string, reply: OutboundMessage): Promise<void> {
    let callbackContext: { flow: string; step: string } | undefined;
    if (reply.choices?.length) {
      const session = await this.stateStore.load(`fsm:${userId}:${channel}`);
      if (session?.flow && session.step) {
        callbackContext = { flow: session.flow, step: session.step };
      }
    }
    const payload = renderForTelegram(reply, callbackContext);
    await this.bot!.api.sendMessage(chatRef, payload.text, { reply_markup: payload.reply_markup });
  }
}
