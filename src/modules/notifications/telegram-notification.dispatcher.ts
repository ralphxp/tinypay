import { Injectable, Logger } from '@nestjs/common';
import { TelegramSenderService } from '../channels/telegram/telegram-sender.service.js';
import { NETWORK_LABEL } from '../../shared/utils/network-label.js';
import { formatNaira } from '../../shared/utils/format-money.js';
import type { NotificationIntent, NotificationSink } from './notification.port.js';

function copyFor(intent: NotificationIntent): string {
  switch (intent.kind) {
    case 'wallet_funded':
      return `Funding received: ${formatNaira(intent.amountMinor)} credited to your wallet.`;
    case 'purchase_completed': {
      const label = intent.type === 'airtime' ? 'Airtime' : 'Data';
      return `${label} sent: ${formatNaira(intent.amountMinor)} ${NETWORK_LABEL[intent.network]} to ${intent.recipientPhone}.`;
    }
    case 'purchase_failed':
      return `${intent.type === 'airtime' ? 'Airtime' : 'Data'} purchase failed and was refunded: ${intent.reason}`;
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

  constructor(private readonly sender: TelegramSenderService) {}

  emit(intent: NotificationIntent): void {
    const text = copyFor(intent);
    this.sender.sendToUser(intent.userId, { text }).catch((err: unknown) => {
      this.logger.error(`Failed to deliver ${intent.kind} notification to user ${intent.userId}`, err);
    });
  }
}
