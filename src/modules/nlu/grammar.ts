/**
 * Deterministic pattern matching for the core money verbs — the floor that
 * never depends on an LLM (guiding principle #9). Slots are returned as raw
 * text; normalizer.ts turns them into real amounts/account numbers.
 */
export type ParsedCommand =
  | { verb: 'balance' }
  | { verb: 'fund' }
  | { verb: 'transfer'; amountText: string; recipientText: string; bankText?: string }
  | { verb: 'withdraw'; amountText: string; recipientText: string; bankText?: string };

const BALANCE = /^(?:bal|balance|my\s+balance|check\s+balance)$/i;
const FUND = /^(?:fund|deposit|add\s+money|top\s*up)(?:\s+(?:my\s+)?wallet)?$/i;
const TRANSFER =
  /^(?:transfer|send|pay)\s+([₦]?[\d.,\s]+|[\d.,\s]+\s*(?:naira|ngn))\s+to\s+(\+?[\d]{8,15})(?:\s+(.+))?$/i;
const WITHDRAW =
  /^withdraw\s+([₦]?[\d.,\s]+|[\d.,\s]+\s*(?:naira|ngn))\s+to\s+(\+?[\d]{8,15})(?:\s+(.+))?$/i;

export function parseGrammar(rawText: string): ParsedCommand | null {
  const text = rawText.trim();

  if (BALANCE.test(text)) return { verb: 'balance' };
  if (FUND.test(text)) return { verb: 'fund' };

  const transfer = TRANSFER.exec(text);
  if (transfer) {
    return {
      verb: 'transfer',
      amountText: transfer[1]!.trim(),
      recipientText: transfer[2]!.trim(),
      bankText: transfer[3]?.trim(),
    };
  }

  const withdraw = WITHDRAW.exec(text);
  if (withdraw) {
    return {
      verb: 'withdraw',
      amountText: withdraw[1]!.trim(),
      recipientText: withdraw[2]!.trim(),
      bankText: withdraw[3]?.trim(),
    };
  }

  return null;
}
