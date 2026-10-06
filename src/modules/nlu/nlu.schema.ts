import { z } from 'zod';

const INTENTS = ['fund', 'balance', 'history', 'airtime', 'data', 'unknown'] as const;

const entitiesSchema = z
  .object({
    amountRaw: z.string().optional(),
    networkRaw: z.string().optional(),
    phoneRaw: z.string().optional(),
  })
  .strict();

/**
 * Validates/clamps every NLU result before it leaves this module — a
 * malformed shape or an intent outside the closed set collapses to
 * 'unknown' rather than reaching the FSM with something unrecognized.
 */
export const nluSchema = z.object({
  intent: z.enum(INTENTS),
  confidence: z.number().min(0).max(1),
  entities: entitiesSchema,
  lang: z.string(),
});

export type Nlu = z.infer<typeof nluSchema>;
