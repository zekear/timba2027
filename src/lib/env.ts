import { config } from 'dotenv';
import { z } from 'zod';

config();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  LLM_TRANSPORT: z.enum(['cli', 'sdk']).default('cli'),
  LLM_CLI_BIN: z.string().default('claude'),
  LLM_CLI_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  POLYMARKET_API_BASE: z.string().url().default('https://gamma-api.polymarket.com'),
  POLYMARKET_POLL_INTERVAL_MIN: z.coerce.number().int().positive().default(15),
  MARKET_MOVE_THRESHOLD_PCT: z.coerce.number().positive().default(2),
  NEWS_POLL_INTERVAL_MIN: z.coerce.number().int().positive().default(15),
  POLLS_POLL_INTERVAL_HOURS: z.coerce.number().int().positive().default(6),
  X_API_BEARER_TOKEN: z.string().optional(),
  X_API_BASE: z.string().url().default('https://api.twitter.com/2'),
  PUBLISH_MODE: z.enum(['shadow', 'soft', 'full']).default('shadow'),
  KILL_SWITCH: z.coerce.boolean().default(false),
  BOT_HANDLE: z.string().default('@Timba2027'),
  SOFT_LAUNCH_DELAY_SEC: z.coerce.number().int().nonnegative().default(60),
  ADMIN_BASIC_AUTH_USER: z.string().optional(),
  ADMIN_BASIC_AUTH_PASS: z.string().optional(),
  SITE_URL: z.string().url().default('https://timba2027.ar'),
  DAILY_PUBLISH_CAP: z.coerce.number().int().positive().default(30),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid env');
}

export const env = parsed.data;
