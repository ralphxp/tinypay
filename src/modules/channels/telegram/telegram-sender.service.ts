import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Bot } from 'grammy';
import { UserService } from '../../identity/user.service.js';
import type { OutboundMessage } from '../../../shared/types/outbound-message.js';
import { renderForTelegram } from './render-outbound.js';
import { TELEGRAM_BOT } from './telegram-bot.provider.js';

/**
 * The place that pushes a message to a user's own Telegram DM by userId —
 * used by ChannelPort.send/fanOutToMembers (a general "message this user")
 * and by the real notification dispatcher (TelegramNotificationDispatcher).
 * A reply *within an ongoing conversation* (including a group reply, which
 * must go back to the group chat, not the user's DM) is sent directly by
 * TelegramAdapter instead — see its sendToChat — since that already knows
 * the originating chat; this service only ever knows a userId.
 *
 * Deliberately userId-in: callers (core money processors) never see or
 * handle a Telegram chat id — this service is the only place that resolves
 * a TinyPay userId to its linked Telegram identity.
 */
@Injectable()
export class TelegramSenderService {
  private readonly logger = new Logger(TelegramSenderService.name);

  constructor(
    @Inject(TELEGRAM_BOT) private readonly bot: Bot | undefined,
    private readonly users: UserService,
  ) {}

  /**
   * `callbackContext`, when given, lets choice-bearing messages (an active
   * FSM step's prompt) render tappable buttons whose callback_data encodes
   * exactly which flow/step they answer (see callback-codec.ts). Omitted
   * for notifications, which never carry choices.
   */
  async sendToUser(
    userId: string,
    message: OutboundMessage,
    callbackContext?: { flow: string; step: string },
  ): Promise<void> {
    if (!this.bot) {
      this.logger.warn('TELEGRAM_BOT_TOKEN not set — dropping outbound Telegram message');
      return;
    }

    const user = await this.users.findById(userId);
    if (!user?.telegramUserId) {
      this.logger.warn(`User ${userId} has no linked Telegram identity — dropping outbound message`);
      return;
    }

    const payload = renderForTelegram(message, callbackContext);
    await this.bot.api.sendMessage(user.telegramUserId, payload.text, { reply_markup: payload.reply_markup });
  }
}
