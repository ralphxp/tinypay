import { Injectable, Logger } from '@nestjs/common';
import { TelegramSenderService } from '../channels/telegram/telegram-sender.service.js';
import { ErrorLogService } from '../../infra/error-log/error-log.service.js';
import { NETWORK_LABEL } from '../../shared/utils/network-label.js';
import { formatNaira } from '../../shared/utils/format-money.js';
import { formatReceiptDate } from '../../shared/utils/format-date.js';
import type { NotificationIntent, NotificationSink } from './notification.port.js';

/** A receipt is a fixed field order, one "Label: value" per line — never a
 * prose sentence, so a user can screenshot it as actual proof of payment. */
function receiptLines(ref: string, fields: [string, string][]): string {
  return ['Receipt', `Ref: ${ref}`, `Date: ${formatReceiptDate(new Date())}`, ...fields.map(([k, v]) => `${k}: ${v}`)].join(
    '\n',
  );
}

/**
 * Customer-facing copy only — never interpolates a provider's raw error
 * text (account balances, internal field names, provider identity) into
 * what a user reads. `reason` on a purchase_failed intent is for the audit
 * trail (WalletTransaction.failureReason) and server logs only; see emit()
 * below for where it actually goes.
 */
function copyFor(intent: NotificationIntent): string {
  switch (intent.kind) {
    case 'wallet_funded': {
      const fields: [string, string][] = [['Type', 'Wallet funding'], ['Amount', formatNaira(intent.amountMinor)]];
      if (intent.feeMinor > 0n) {
        fields.push(['Fee', formatNaira(intent.feeMinor)], ['Total paid', formatNaira(intent.amountMinor + intent.feeMinor)]);
      }
      fields.push(['Status', 'Completed']);
      return receiptLines(intent.ref, fields);
    }
    case 'purchase_completed': {
      const label = intent.type === 'airtime' ? 'Airtime' : 'Data';
      return receiptLines(intent.ref, [
        ['Type', label],
        ['Amount', formatNaira(intent.amountMinor)],
        ['Network', NETWORK_LABEL[intent.network]],
        ['Recipient', intent.recipientPhone],
        ['Status', 'Completed'],
      ]);
    }
    case 'purchase_failed': {
      const label = intent.type === 'airtime' ? 'Airtime' : 'Data';
      return `${label} purchase failed and was refunded.`;
    }
  }
}

/**
 * The real send: turns a produced NotificationIntent (wallet funding,
 * airtime/data purchase outcome) into an actual Telegram message, via the
 * same TelegramSenderService the FSM's own replies go through (so
 * rendering/masking/envelope stays identical either way). A money/biller
 * processor never depends on this directly — it only ever emits an intent
 * through NotificationSink; this is just the binding of that port that
 * finally makes good on it.
 */
@Injectable()
export class TelegramNotificationDispatcher implements NotificationSink {
  private readonly logger = new Logger(TelegramNotificationDispatcher.name);

  constructor(
    private readonly sender: TelegramSenderService,
    private readonly errorLog: ErrorLogService,
  ) {}

  emit(intent: NotificationIntent): void {
    if (intent.kind === 'purchase_failed') {
      // Server-side only — the provider's raw reason (balances, field
      // names, provider identity) must never reach the customer, but it's
      // still the thing an operator needs to actually diagnose a failure.
      // Persisted (not just logged) so it survives past Render's ephemeral
      // log retention and is queryable later.
      this.logger.warn(`purchase_failed ref=${intent.ref} userId=${intent.userId}: ${intent.reason}`);
      this.errorLog.log({
        source: 'purchase_failed',
        message: intent.reason,
        context: { ref: intent.ref, userId: intent.userId, type: intent.type, amountMinor: intent.amountMinor.toString() },
      });
    }
    const text = copyFor(intent);
    this.sender.sendToUser(intent.userId, { text }).catch((err: unknown) => {
      this.logger.error(`Failed to deliver ${intent.kind} notification to user ${intent.userId}`, err);
    });
  }
}
