import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

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
  CASCADE_DELETE_LOG_DAYS: z.string().default('30').transform(Number),
}).refine((data) => data.PORT || data.SERVER_PORT, {
  message: 'Either PORT or SERVER_PORT must be provided',
  path: ['PORT'],
});

const envServer = envSchema.safeParse(process.env);

if (!envServer.success) {
  console.error('❌ Invalid environment variables:', envServer.error.format());
  process.exit(1);
}

export const env = envServer.data;
