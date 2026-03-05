import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const isTestRuntime = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
const TEST_DEFAULT_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';

const runtimeEnv: Record<string, string | undefined> = {
  ...process.env,
};

// Provide safe defaults for test runtime so unit tests do not require a local .env file.
if (isTestRuntime) {
  runtimeEnv.PORT ??= '3000';
  runtimeEnv.MONGO_HOSTNAME ??= 'localhost';
  runtimeEnv.MONGO_DATABASE ??= 'reblock_test';
  runtimeEnv.ENCRYPTION_KEY ??= TEST_DEFAULT_KEY;
  runtimeEnv.RETENTION_SCHEDULER_ENABLED ??= 'false';
}

/** Helper: parse string to positive integer with pipe validation */
const positiveInt = (defaultVal: string) =>
  z.string().default(defaultVal).transform(Number).pipe(z.number().int().positive());


const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.string().transform(Number).pipe(z.number().int().nonnegative()).optional(),
  SERVER_PORT: z.string().transform(Number).pipe(z.number().int().nonnegative()).optional(),
  API_BASE_URL: z.string().url().transform(s => s.replace(/\/$/, '')).optional(),

  MONGO_HOSTNAME: z.string().min(1, 'MongoDB hostname is required'),
  MONGO_PORT: positiveInt('27017'),
  MONGO_DATABASE: z.string().min(1, 'MongoDB database name is required'),
  MONGO_USERNAME: z.string().optional(),
  MONGO_PASSWORD: z.string().optional(),

  STORAGE_TEMP_DIR: z.string().default('./storage/_temp'),
  STORAGE_BLOCK_DIR: z.string().default('./storage/blocks'),
  STORAGE_LOG_DIR: z.string().default('./storage/_logs'),
  
  ENCRYPTION_KEY: z.string().min(1, 'Encryption key is required'),

  CLEANUP_DEFAULT_DAYS: positiveInt('30'),
  CLEANUP_BACKUP_REMINDER: z.string().default('true'),

  LOG_TTL_DAYS: positiveInt('90'),
  LOG_ARCHIVE_DAYS: positiveInt('30'),
  LOG_ARCHIVE_TZ: z.string().default('Asia/Shanghai'),
  LOG_DEDUP_WINDOW_MINUTES: positiveInt('10'),
  ERROR_FALLBACK_LOG_FILE: z.string().default('./storage/_logs/runtime-fallback.log'),
  CASCADE_DELETE_LOG_DAYS: positiveInt('30'),
  METRICS_SNAPSHOT_INTERVAL_MINUTES: positiveInt('5'),
  METRICS_WINDOW_MINUTES: positiveInt('5'),
  RETENTION_SCHEDULER_ENABLED: z.string().default('true').transform(v => v === 'true'),
  RETENTION_SCHEDULER_INTERVAL_MS: positiveInt('300000'),
  RETENTION_SCHEDULER_LIMIT: positiveInt('1000'),
  RETENTION_SCHEDULER_LOCK_TTL_MS: positiveInt('600000'),
  UPLOAD_MAX_INFLIGHT: positiveInt('4'),
  UPLOAD_QUEUE_MAX: positiveInt('32'),
  UPLOAD_QUEUE_TIMEOUT_MS: positiveInt('15000'),
  MIGRATION_MAX_INFLIGHT: positiveInt('1'),
  MIGRATION_QUEUE_MAX: positiveInt('8'),
  MIGRATION_QUEUE_TIMEOUT_MS: positiveInt('10000'),
  OVERLOAD_STATUS_CODE: positiveInt('429'),
  MIGRATION_MAX_PAYLOAD_BYTES: positiveInt('8388608'),
  MIGRATION_MAX_BASE64_CHARS: positiveInt('11184812'),

  // Migration API configuration
  MIGRATION_API_ENABLED: z.string().default('false').transform(v => v === 'true'),
  API_AUTH_TOKEN: z.string().optional(),
  MIGRATION_API_TOKEN: z.string().optional(),
  ERRORS_API_TOKEN: z.string().optional(),
}).refine((data) => data.PORT || data.SERVER_PORT, {
  message: 'Either PORT or SERVER_PORT must be provided',
  path: ['PORT'],
}).refine((data) => {
  // Validate ENCRYPTION_KEY is valid base64 decoding to exactly 32 bytes
  try {
    const buf = Buffer.from(data.ENCRYPTION_KEY, 'base64');
    return buf.length === 32;
  } catch {
    return false;
  }
}, {
  message: 'ENCRYPTION_KEY must be valid base64 encoding of exactly 32 bytes',
  path: ['ENCRYPTION_KEY'],
}).refine((data) => {
  // Reject the well-known test key in production
  if (data.NODE_ENV === 'production' && data.ENCRYPTION_KEY === TEST_DEFAULT_KEY) {
    return false;
  }
  return true;
}, {
  message: 'Default test encryption key must not be used in production',
  path: ['ENCRYPTION_KEY'],
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
