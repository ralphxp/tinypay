import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Bot, type Context } from 'grammy';
import type { Update } from 'grammy/types';
import { ConfigService } from '../../../config/config.service.js';
import { UserService } from '../../identity/user.service.js';
import { ConversationService } from '../../conversation/conversation.service.js';
import { normalizePhone } from '../../nlu/normalizer.js';
import type { ChannelPort, OutboundMessage } from '../channel.port.js';

@Injectable()
export class TelegramService implements ChannelPort, OnModuleInit {
  readonly channel = 'telegram' as const;
  private readonly logger = new Logger(TelegramService.name);
  // Undefined when TELEGRAM_BOT_TOKEN isn't configured (e.g. local dev/tests
  // that don't touch Telegram) — every method below no-ops in that case.
  private readonly bot: Bot | undefined;

  constructor(
    config: ConfigService,
    private readonly users: UserService,
    private readonly conversation: ConversationService,
  ) {
    const token = config.get('TELEGRAM_BOT_TOKEN');
    this.bot = token ? new Bot(token) : undefined;
  }

  onModuleInit(): void {
    if (!this.bot) {
      this.logger.warn('TELEGRAM_BOT_TOKEN not set — Telegram channel is disabled');
      return;
    }
    this.bot.on('message:contact', (ctx) => this.handleContact(ctx));
    this.bot.on('message:text', (ctx) => this.handleText(ctx));
  }

  async handleUpdate(update: Update): Promise<void> {
    await this.bot?.handleUpdate(update);
  }

  supportsGroupSurface(): boolean {
    return true;
  }

  async send(message: OutboundMessage): Promise<void> {
    await this.bot?.api.sendMessage(message.chatRef, message.text);
  }

  async fanOut(chatRefs: string[], text: string): Promise<void> {
    await Promise.all(chatRefs.map((chatRef) => this.send({ chatRef, text })));
  }

  private async handleContact(ctx: Context): Promise<void> {
    const contact = ctx.message?.contact;
    if (!contact || !ctx.from) return;
    // Only accept the sender's own contact card, not one forwarded from someone else.
    if (contact.user_id !== ctx.from.id) {
      await ctx.reply('Please share your own contact, not someone else\'s.');
      return;
    }

    const phone = normalizePhone(contact.phone_number);
    const user = await this.users.findOrCreateByPhone(phone);
    await this.users.linkTelegramUserId(user.id, String(ctx.from.id));
    await ctx.reply('You\'re all set. Try "balance" or "fund".', { reply_markup: { remove_keyboard: true } });
  }

  private async handleText(ctx: Context): Promise<void> {
    if (!ctx.from || !ctx.chat || !ctx.message?.text) return;

    const user = await this.users.findByTelegramUserId(String(ctx.from.id));
    if (!user) {
      await ctx.reply('Welcome to TinyPay! Please share your phone number to get started.', {
        reply_markup: {
          keyboard: [[{ text: 'Share phone number', request_contact: true }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      });
      return;
    }

    try {
      const reply = await this.conversation.handleMessage({
        chatRef: String(ctx.chat.id),
        userId: user.id,
        text: ctx.message.text,
      });
      await ctx.reply(reply);
    } catch (err) {
      this.logger.error(err instanceof Error ? err.stack : err);
      await ctx.reply("Something went wrong on our end — that didn't go through. Please try again.");
    }
  }
}
