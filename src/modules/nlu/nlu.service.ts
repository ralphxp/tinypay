import { Injectable } from '@nestjs/common';
import { parseGrammar } from './grammar.js';
import { nluSchema, type Nlu } from './nlu.schema.js';

const UNKNOWN: Nlu = { intent: 'unknown', confidence: 0, entities: {}, lang: 'en' };

export interface NluContext {
  lang?: string;
}

/**
 * Deterministic, grammar-only — no LLM fallback in this build (that's P4
 * scope, out of the narrowed app). A grammar miss is always 'unknown'.
 */
@Injectable()
export class NluService {
  async parse(utterance: string, ctx: NluContext = {}): Promise<Nlu> {
    const grammarMatch = parseGrammar(utterance);
    if (!grammarMatch) return UNKNOWN;

    const result = nluSchema.safeParse({
      intent: grammarMatch.intent,
      confidence: 1,
      entities: grammarMatch.entities,
      lang: ctx.lang ?? 'en',
    });
    return result.success ? result.data : UNKNOWN;
  }
}
