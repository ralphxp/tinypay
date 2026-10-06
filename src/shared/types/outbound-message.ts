/**
 * A tappable reply option. A plain string is both the displayed label and
 * the value fed back on tap (fine for short, closed-vocabulary choices like
 * 'yes'/'cancel'/network names). Use `{label, value}` when the display text
 * is long or dynamic (e.g. a data plan's "1GB — 30 days — ₦435.00") but the
 * value fed back must stay short — Telegram caps callback_data at 64 bytes
 * (see callback-codec.ts), and a long label alone would blow that budget.
 */
export type Choice = string | { label: string; value: string };

/**
 * Channel-agnostic reply produced by the FSM (ConversationService) — a
 * channel adapter (TelegramAdapter, a future WhatsAppAdapter) is solely
 * responsible for rendering it into its own wire format. Core code must
 * never format, mask, or otherwise touch presentation concerns; that's the
 * adapter/renderer's job (see modules/channels/renderers).
 */
export interface OutboundMessage {
  text: string;
  /** Discrete reply options — a channel that supports it (Telegram) renders
   * these as tappable buttons instead of free text. */
  choices?: Choice[];
}
