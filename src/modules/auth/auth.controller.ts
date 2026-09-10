import { Body, Controller, Param, Post } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { JournalEntryKind, TransactionType } from '@prisma/client';
import { AuthLinkError, AuthLinkService } from './auth-link.service.js';
import { PinService, InvalidPinError } from './pin.service.js';
import { SetPinDto } from './dto/set-pin.dto.js';
import { ConfirmMoneyActionDto } from './dto/confirm-money-action.dto.js';
import { LedgerService } from '../wallet/ledger.service.js';
import { PrismaService } from '../../infra/database/prisma.service.js';
import { PAYOUT_QUEUE } from '../../infra/queue/queue.constants.js';
import type { ConfirmMoneyActionData } from '../../shared/types/money-action.js';

@Controller('auth/link')
export class AuthController {
  constructor(
    private readonly authLinks: AuthLinkService,
    private readonly pin: PinService,
    private readonly ledger: LedgerService,
    private readonly prisma: PrismaService,
    @InjectQueue(PAYOUT_QUEUE) private readonly payoutQueue: Queue,
  ) {}

  /**
   * Consumes a single-use `set_pin` link (see AuthLinkService) and sets the
   * PIN. This is the "PIN via web" path — the PIN itself only ever reaches
   * the backend through this HTTP body, never through a chat message.
   */
  @Post(':token/pin')
  async setPin(@Param('token') token: string, @Body() dto: SetPinDto): Promise<{ ok: true }> {
    const payload = await this.authLinks.verifyAndConsume(token);
    if (payload.action !== 'set_pin') {
      throw new AuthLinkError('This link is not authorized to set a PIN');
    }
    await this.pin.setPin(payload.userId, dto.pin);
    return { ok: true };
  }

  /**
   * Consumes a single-use `confirm_money_action` link and, given the correct
   * PIN, posts the exact ledger legs that were resolved when the link was
   * minted (guiding principle #5 — consent per debit). If the action needs
   * an outbound PSP transfer, that's handed off to PayoutProcessor.
   */
  @Post(':token/confirm')
  async confirmMoneyAction(
    @Param('token') token: string,
    @Body() dto: ConfirmMoneyActionDto,
  ): Promise<{ ok: true }> {
    const payload = await this.authLinks.verifyAndConsume<ConfirmMoneyActionData>(token);
    if (payload.action !== 'confirm_money_action') {
      throw new AuthLinkError('This link is not authorized to confirm a payment');
    }

    const validPin = await this.pin.verifyPin(payload.userId, dto.pin);
    if (!validPin) {
      throw new InvalidPinError('Incorrect PIN');
    }

    const { data } = payload;
    const { entry } = await this.ledger.postEntry({
      externalRef: data.externalRef,
      kind: data.verb as JournalEntryKind,
      legs: data.legs.map((leg) => ({
        accountRef: leg.accountRef,
        amountMinor: BigInt(leg.amountMinor),
      })),
    });

    const txn = await this.prisma.transaction.create({
      data: {
        ref: data.externalRef,
        userId: payload.userId,
        type: data.verb as TransactionType,
        amountMinor: BigInt(data.amountMinor),
        status: data.payout ? 'pending' : 'completed',
        idempotencyKey: data.externalRef,
        journalEntryId: entry.id,
      },
    });

    if (data.payout) {
      await this.payoutQueue.add(
        'execute-payout',
        {
          transactionId: txn.id,
          accountNumber: data.payout.accountNumber,
          bankCode: data.payout.bankCode,
          accountName: data.payout.accountName,
          amountMinor: data.amountMinor,
        },
        { attempts: 1 },
      );
    }

    return { ok: true };
  }
}
