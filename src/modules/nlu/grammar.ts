import type { Intent } from '../../shared/types/intent.js';

/**
 * Raw entity strings only — nothing here is canonicalized. amountRaw stays
 * "500", networkRaw stays whatever word the user typed ("mtn", "9mobile").
 * Only normalizer.ts turns these into a bigint/Network enum value a slot
 * actually holds.
 */
export interface RawEntities {
  amountRaw?: string;
  networkRaw?: string;
  /** A recipient phone, when the message names one explicitly rather than "for myself". */
  phoneRaw?: string;
}

export interface GrammarMatch {
  intent: Intent;
  entities: RawEntities;
}

const NETWORK_WORD = 'mtn|glo|airtel|9\\s*-?\\s*mobile|nine\\s*mobile';
const PHONE_WORD = '\\+?\\d{10,14}';
const AMOUNT_WORD = '₦?[\\d][\\d.,]*\\s*k?|₦?[\\d][\\d.,]*\\s*(?:naira|ngn)';
/** "buy"/"send" are interchangeable ("buy me airtime" == "send me airtime" == "airtime") — all optional, including the bare noun on its own. */
const VERB = '(?:(?:buy|send)\\s+(?:me\\s+)?)?';
/** An optional "for"/"to" connector before a recipient phone ("send airtime for 08012345678" or just "... 08012345678"). */
const CONNECTOR = '(?:(?:for|to)\\s+)?';

const FUND = new RegExp(`^(?:fund|deposit|add\\s+money|top\\s*up)(?:\\s+(?:my\\s+)?wallet)?(?:\\s+(?<amount>${AMOUNT_WORD}))?$`, 'i');
const BALANCE = /^(?:bal|balance|my\s+balance|check\s+balance)$/i;
const HISTORY = /^(?:history|transactions|statement|my\s+transactions)$/i;

// "airtime", "buy airtime", "send me airtime", "buy airtime 500", "buy airtime 500 mtn",
// "mtn airtime 500 08012345678", "send airtime for 08012345678"
const AIRTIME = new RegExp(
  `^(?:(?<net1>${NETWORK_WORD})\\s+)?${VERB}airtime` +
    `(?:\\s+(?<amount>${AMOUNT_WORD}))?` +
    `(?:\\s+(?<net2>${NETWORK_WORD}))?` +
    `(?:\\s+${CONNECTOR}(?<phone>${PHONE_WORD}))?$`,
  'i',
);
// "data", "buy data", "send me data", "buy data mtn", "mtn data for 08012345678"
const DATA = new RegExp(
  `^(?:(?<net1>${NETWORK_WORD})\\s+)?${VERB}data` +
    `(?:\\s+(?<net2>${NETWORK_WORD}))?` +
    `(?:\\s+${CONNECTOR}(?<phone>${PHONE_WORD}))?$`,
  'i',
);

function match(regex: RegExp, text: string): RegExpExecArray | null {
  return regex.exec(text.trim());
}

/**
 * Deterministic verb-first matching for the four supported verbs
 * (fund/balance/history/airtime/data). help/cancel/menu/back are global
 * interrupts handled upstream by InvocationGate.matchInterrupt — they never
 * reach grammar at all (see ConversationService.handleText), so there's no
 * intent for them here. Returns null on no match; NluService maps that to
 * intent:'unknown'.
 */
export function parseGrammar(rawText: string): GrammarMatch | null {
  const text = rawText.trim();
  if (!text) return null;

  let m = match(FUND, text);
  if (m) return { intent: 'fund', entities: { amountRaw: m.groups?.amount?.trim() } };

  if (BALANCE.test(text)) return { intent: 'balance', entities: {} };
  if (HISTORY.test(text)) return { intent: 'history', entities: {} };

  m = match(AIRTIME, text);
  if (m) {
    return {
      intent: 'airtime',
      entities: {
        networkRaw: (m.groups?.net1 ?? m.groups?.net2)?.trim(),
        amountRaw: m.groups?.amount?.trim(),
        phoneRaw: m.groups?.phone?.trim(),
      },
    };
  }

  m = match(DATA, text);
  if (m) {
    return {
      intent: 'data',
      entities: {
        networkRaw: (m.groups?.net1 ?? m.groups?.net2)?.trim(),
        phoneRaw: m.groups?.phone?.trim(),
      },
    };
  }

  return null;
}
