import { z } from 'zod';

export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_BASE_URL: z.url(),

  DATABASE_URL: z.url(),

  PAYSTACK_SECRET_KEY: z.string().optional(),
  PAYSTACK_PUBLIC_KEY: z.string().optional(),

  BIGISUB_API_TOKEN: z.string().optional(),
  BIGISUB_TRANSACTION_PIN: z.string().optional(),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),

  // WhatsApp via Twilio (not Meta's own Cloud API directly) — Twilio acts as
  // the BSP, so auth/webhook-signing/send-message all go through Twilio's
  // own API shape, not Meta's Graph API.
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  /** The sandbox (or, later, a real approved) WhatsApp sender, e.g. "whatsapp:+14155238886". */
  TWILIO_WHATSAPP_NUMBER: z.string().optional(),
});

export type AppConfig = z.infer<typeof configSchema>;

export function validateConfig(raw: Record<string, unknown>): AppConfig {
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
