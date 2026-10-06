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

  WA_PHONE_NUMBER_ID: z.string().optional(),
  WA_BUSINESS_ACCOUNT_ID: z.string().optional(),
  WA_ACCESS_TOKEN: z.string().optional(),
  WA_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  WA_APP_SECRET: z.string().optional(),
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
