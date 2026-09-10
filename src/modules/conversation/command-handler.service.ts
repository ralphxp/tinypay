import { Injectable, Logger } from '@nestjs/common';
import { ulid } from 'ulid';
import { StateStore } from './state.store.js';
import { NluService, type NluResult } from '../nlu/nlu.service.js';
import { SourceAccountResolver } from '../resolver/source-account.resolver.js';
import { UserService } from '../identity/user.service.js';
import { EnrollmentService } from '../identity/enrollment.service.js';
import { BalanceService } from '../wallet/balance.service.js';
import { AccountService } from '../wallet/account.service.js';
import { AuthLinkService } from '../auth/auth-link.service.js';
import { PaymentsOrchestrator } from '../payments/payments.orchestrator.js';
import { PrismaService } from '../../infra/database/prisma.service.js';
import { formatNaira } from '../../shared/utils/format-money.js';
import type { TransferTarget } from '../../shared/types/intent.js';
import type { ConfirmMoneyActionData } from '../../shared/types/money-action.js';

export interface IncomingMessage {
  chatRef: string;
  userId: string;
  text: string;
}

const HELP_TEXT = [
  "Sorry, I didn't catch that. Here's what I can do:",
  '• balance — check your wallet balance',
  '• fund — get your top-up account number',
  '• transfer <amount> to <phone or account> [bank] — send money',
  '• withdraw <amount> to <account> <bank> — cash out to your bank',
].join('\n');

const LOCK_TTL_MS = 15_000;

@Injectable()
export class CommandHandlerService {
  private readonly logger = new Logger(CommandHandlerService.name);

  constructor(
    private readonly stateStore: StateStore,
    private readonly nlu: NluService,
    private readonly resolver: SourceAccountResolver,
    private readonly users: UserService,
    private readonly enrollment: EnrollmentService,
    private readonly balances: BalanceService,
    private readonly accounts: AccountService,
    private readonly authLinks: AuthLinkService,
    private readonly payments: PaymentsOrchestrator,
    private readonly prisma: PrismaService,
  ) {}

  async handleMessage(input: IncomingMessage): Promise<string> {
    const lockKey = `telegram_dm:${input.chatRef}`;
    const token = await this.stateStore.acquire(lockKey, LOCK_TTL_MS);
    if (!token) return 'Still working on your last message, one moment.';

    try {
      const result = await this.nlu.parse(input.text);
      switch (result.intent) {
        case 'unknown':
          return HELP_TEXT;
        case 'balance':
          return this.handleBalance(input.userId);
        case 'fund':
          return this.handleFund(input.userId);
        case 'transfer':
          return this.handleTransfer(input.userId, result);
        case 'withdraw':
          return this.handleWithdraw(input.userId, result);
      }
    } catch (err) {
      this.logger.error(err instanceof Error ? err.stack : err);
      return "Something went wrong on our end — that didn't go through. Please try again.";
    } finally {
      await this.stateStore.release(lockKey, token);
    }
  }

  private async handleBalance(userId: string): Promise<string> {
    const wallet = await this.accounts.findByRef({ ownerType: 'user', ownerId: userId, kind: 'wallet' });
    const balance = wallet ? await this.balances.getBalance(wallet.id) : 0n;
    return `Your balance is ${formatNaira(balance)}.`;
  }

  private async handleFund(userId: string): Promise<string> {
    const user = await this.users.findById(userId);
    if (!user) return "I couldn't find your account — try again in a moment.";

    if (user.dvaAccountNumber) {
      return `Send money to your top-up account: ${user.dvaAccountNumber}.`;
    }

    const dva = await this.payments.forCurrency('NGN').createDva({
      userId,
      email: user.email ?? `${user.phone.replace('+', '')}@tinypay.invalid`,
      fullName: user.fullName ?? user.phone,
      phone: user.phone,
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { paystackCustomerCode: dva.customerCode, dvaAccountNumber: dva.accountNumber },
    });

    return `Fund your wallet anytime by sending money to:\n${dva.accountNumber} — ${dva.bankName}\n(${dva.accountName})`;
  }

  private async handleTransfer(
    userId: string,
    result: Extract<NluResult, { intent: 'transfer' }>,
  ): Promise<string> {
    if (!(await this.enrollment.isEnrolled(userId))) {
      return this.promptSetPin(userId);
    }

    let target: TransferTarget;
    let recipientLabel: string;

    if ('recipientPhone' in result) {
      const recipient = await this.users.findByPhone(result.recipientPhone);
      if (!recipient) return "I couldn't find a TinyPay user with that phone number.";
      target = { type: 'user', userId: recipient.id };
      recipientLabel = recipient.fullName ?? recipient.phone;
    } else {
      const resolved = await this.payments
        .forCurrency('NGN')
        .resolveAccount({ accountNumber: result.accountNumber, bankCode: result.bankCode });
      target = { type: 'external_bank', accountNumber: result.accountNumber, bankCode: result.bankCode };
      recipientLabel = `${resolved.accountName} (${resolved.accountNumber})`;
    }

    const resolution = this.resolver.resolve({
      surface: 'telegram_dm',
      verb: 'transfer',
      actor: { userId },
      target,
    });

    const data: ConfirmMoneyActionData = {
      verb: 'transfer',
      externalRef: `tinypay:${ulid()}`,
      legs: [
        { accountRef: resolution.source, amountMinor: (-result.amountMinor).toString() },
        { accountRef: resolution.dest, amountMinor: result.amountMinor.toString() },
      ],
      amountMinor: result.amountMinor.toString(),
      payout:
        target.type === 'external_bank'
          ? { accountNumber: target.accountNumber, bankCode: target.bankCode, accountName: recipientLabel }
          : undefined,
    };

    const url = this.authLinks.createUrl(userId, 'confirm_money_action', data);
    return `Confirm: send ${formatNaira(result.amountMinor)} to ${recipientLabel}.\nEnter your PIN to approve: ${url}`;
  }

  private async handleWithdraw(
    userId: string,
    result: Extract<NluResult, { intent: 'withdraw' }>,
  ): Promise<string> {
    if (!(await this.enrollment.isEnrolled(userId))) {
      return this.promptSetPin(userId);
    }

    const resolved = await this.payments
      .forCurrency('NGN')
      .resolveAccount({ accountNumber: result.accountNumber, bankCode: result.bankCode });

    const resolution = this.resolver.resolve({
      surface: 'telegram_dm',
      verb: 'withdraw',
      actor: { userId },
    });

    const data: ConfirmMoneyActionData = {
      verb: 'withdraw',
      externalRef: `tinypay:${ulid()}`,
      legs: [
        { accountRef: resolution.source, amountMinor: (-result.amountMinor).toString() },
        { accountRef: resolution.dest, amountMinor: result.amountMinor.toString() },
      ],
      amountMinor: result.amountMinor.toString(),
      payout: { accountNumber: result.accountNumber, bankCode: result.bankCode, accountName: resolved.accountName },
    };

    const url = this.authLinks.createUrl(userId, 'confirm_money_action', data);
    return `Confirm: withdraw ${formatNaira(result.amountMinor)} to ${resolved.accountName} (${resolved.accountNumber}).\nEnter your PIN to approve: ${url}`;
  }

  private promptSetPin(userId: string): string {
    const url = this.authLinks.createUrl(userId, 'set_pin', undefined);
    return `You need to set a PIN before moving money. Set it here: ${url}`;
  }
}
