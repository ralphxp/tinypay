import { Injectable } from '@nestjs/common';
import { parseGrammar } from './grammar.js';
import { NormalizerService, isLikelyPhoneNumber, normalizePhone, parseAmountToMinor } from './normalizer.js';

export type NluResult =
  | { intent: 'balance' }
  | { intent: 'fund' }
  | { intent: 'transfer'; amountMinor: bigint; recipientPhone: string }
  | { intent: 'transfer'; amountMinor: bigint; accountNumber: string; bankCode: string }
  | { intent: 'withdraw'; amountMinor: bigint; accountNumber: string; bankCode: string }
  | { intent: 'unknown' };

const UNKNOWN: NluResult = { intent: 'unknown' };

/**
 * Grammar-first, deterministic. An LLM fallback for free-form/Pidgin phrasing
 * is P4 scope (docs/SPEC.md section 10) — until then, no match just means
 * "unknown" and the conversation layer shows a menu.
 */
@Injectable()
export class NluService {
  constructor(private readonly normalizer: NormalizerService) {}

  async parse(text: string): Promise<NluResult> {
    const parsed = parseGrammar(text);
    if (!parsed) return UNKNOWN;

    switch (parsed.verb) {
      case 'balance':
        return { intent: 'balance' };

      case 'fund':
        return { intent: 'fund' };

      case 'transfer': {
        const amountMinor = parseAmountToMinor(parsed.amountText);
        if (!amountMinor) return UNKNOWN;

        if (isLikelyPhoneNumber(parsed.recipientText)) {
          return { intent: 'transfer', amountMinor, recipientPhone: normalizePhone(parsed.recipientText) };
        }

        if (!parsed.bankText) return UNKNOWN;
        const bankCode = await this.normalizer.resolveBankCode(parsed.bankText);
        if (!bankCode) return UNKNOWN;
        return { intent: 'transfer', amountMinor, accountNumber: parsed.recipientText, bankCode };
      }

      case 'withdraw': {
        const amountMinor = parseAmountToMinor(parsed.amountText);
        if (!amountMinor || !parsed.bankText) return UNKNOWN;

        const bankCode = await this.normalizer.resolveBankCode(parsed.bankText);
        if (!bankCode) return UNKNOWN;
        return { intent: 'withdraw', amountMinor, accountNumber: parsed.recipientText, bankCode };
      }
    }
  }
}
