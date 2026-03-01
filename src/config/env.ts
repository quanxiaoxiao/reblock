import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const isTestRuntime = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';

const runtimeEnv: Record<string, string | undefined> = {
  ...process.env,
};

// Provide safe defaults for test runtime so unit tests do not require a local .env file.
if (isTestRuntime) {
  runtimeEnv.PORT ??= '3000';
  runtimeEnv.MONGO_HOSTNAME ??= 'localhost';
  runtimeEnv.MONGO_DATABASE ??= 'reblock_test';
  runtimeEnv.ENCRYPTION_KEY ??= 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.string().transform(Number).optional(),
  SERVER_PORT: z.string().transform(Number).optional(),
  API_BASE_URL: z.string().url().optional(),

  MONGO_HOSTNAME: z.string().min(1, 'MongoDB hostname is required'),
  MONGO_PORT: z.string().default('27017').transform(Number),
  MONGO_DATABASE: z.string().min(1, 'MongoDB database name is required'),
  MONGO_USERNAME: z.string().optional(),
  MONGO_PASSWORD: z.string().optional(),

  STORAGE_TEMP_DIR: z.string().default('./storage/_temp'),
  STORAGE_BLOCK_DIR: z.string().default('./storage/blocks'),
  STORAGE_LOG_DIR: z.string().default('./storage/_logs'),
  
  ENCRYPTION_KEY: z.string().min(1, 'Encryption key is required'),

  CLEANUP_DEFAULT_DAYS: z.string().default('30').transform(Number),
  CLEANUP_BACKUP_REMINDER: z.string().default('true'),

  LOG_TTL_DAYS: z.string().default('90').transform(Number),
  LOG_ARCHIVE_DAYS: z.string().default('30').transform(Number),
  LOG_DEDUP_WINDOW_MINUTES: z.string().default('10').transform(Number),
  CASCADE_DELETE_LOG_DAYS: z.string().default('30').transform(Number),
  METRICS_SNAPSHOT_INTERVAL_MINUTES: z.string().default('5').transform(Number),
  METRICS_WINDOW_MINUTES: z.string().default('5').transform(Number),

  // Migration API configuration
  MIGRATION_API_ENABLED: z.string().default('false').transform(v => v === 'true'),
  MIGRATION_API_TOKEN: z.string().optional(),
}).refine((data) => data.PORT || data.SERVER_PORT, {
  message: 'Either PORT or SERVER_PORT must be provided',
  path: ['PORT'],
});

const envServer = envSchema.safeParse(runtimeEnv);

if (!envServer.success) {
  console.error('❌ Invalid environment variables:', envServer.error.format());
  if (isTestRuntime) {
    throw new Error('Invalid environment variables in test runtime');
  }
  process.exit(1);
}

export const env = envServer.data;
