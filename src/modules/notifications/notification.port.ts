import { Injectable, Logger } from '@nestjs/common';
import type { Network } from '@prisma/client';

export const NOTIFICATION_SINK = Symbol('NOTIFICATION_SINK');

export interface WalletFundedIntent {
  kind: 'wallet_funded';
  userId: string;
  amountMinor: bigint;
  ref: string;
}

export interface PurchaseCompletedIntent {
  kind: 'purchase_completed';
  userId: string;
  type: 'airtime' | 'data';
  network: Network;
  recipientPhone: string;
  amountMinor: bigint;
  ref: string;
}

export interface PurchaseFailedIntent {
  kind: 'purchase_failed';
  userId: string;
  type: 'airtime' | 'data';
  amountMinor: bigint;
  reason: string;
  ref: string;
}

export type NotificationIntent = WalletFundedIntent | PurchaseCompletedIntent | PurchaseFailedIntent;

/**
 * A money/biller processor's job ends at "wallet-true + an outbound intent
 * exists" — it never sends anything itself. Wiring this straight to a
 * channel would pull the channel layer into a processor and couple two
 * things that must stay separate; the real send (TelegramNotificationDispatcher)
 * consumes intents produced here, it doesn't live here.
 */
export interface NotificationSink {
  emit(intent: NotificationIntent): void;
}

/** Test/local-dev stand-in — records/logs the intent; nothing is ever sent. */
@Injectable()
export class LoggingNotificationSink implements NotificationSink {
  private readonly logger = new Logger(LoggingNotificationSink.name);
  private readonly emitted: NotificationIntent[] = [];

  emit(intent: NotificationIntent): void {
    this.emitted.push(intent);
    this.logger.log(
      `Notification intent: ${JSON.stringify({ ...intent, amountMinor: intent.amountMinor.toString() })}`,
    );
  }

  /** Test-only introspection — a real sink wouldn't need this. */
  getEmitted(): readonly NotificationIntent[] {
    return this.emitted;
  }
}
