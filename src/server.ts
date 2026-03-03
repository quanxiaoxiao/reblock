import { serve } from '@hono/node-server';
import app from './app';
import { env } from './config/env';
import { schedule } from 'node-cron';
import mongoose from 'mongoose';
import { randomUUID } from 'crypto';
import { logService } from './services/logService';
import { metricsSnapshotService } from './services/metricsSnapshotService';

const port = env.PORT || env.SERVER_PORT || 3000;
const archiveLockKey = 'log_archive_scheduler';
const archiveLockOwner = `${process.pid}-${randomUUID()}`;
const archiveLockTtlMs = 30 * 60 * 1000;
let archiveLockIndexEnsured = false;

async function ensureArchiveLockIndex(): Promise<void> {
  if (archiveLockIndexEnsured) {
    return;
  }

  const db = mongoose.connection.db;
  if (!db) {
    return;
  }

  await db.collection('_schedulerLocks').createIndex({ key: 1 }, { unique: true });
  archiveLockIndexEnsured = true;
}

async function acquireArchiveLock(): Promise<boolean> {
  const db = mongoose.connection.db;
  if (!db) {
    return false;
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + archiveLockTtlMs);

  await ensureArchiveLockIndex();

  try {
    const result = await db.collection('_schedulerLocks').findOneAndUpdate(
      {
        key: archiveLockKey,
        $or: [{ expiresAt: { $lte: now } }, { owner: archiveLockOwner }],
      },
      {
        $set: {
          key: archiveLockKey,
          owner: archiveLockOwner,
          acquiredAt: now,
          expiresAt,
        },
      },
      { upsert: true, returnDocument: 'after' }
    );

    const owner = (result as { owner?: string; value?: { owner?: string } } | null)?.owner
      || (result as { owner?: string; value?: { owner?: string } } | null)?.value?.owner;

    return owner === archiveLockOwner;
  } catch (error: unknown) {
    const err = error as { code?: number };
    if (err?.code === 11000) {
      return false;
    }
    throw error;
  }
}

// Initialize log archive scheduler (daily at 03:00 AM)
// Skip in test environment to avoid interference with tests
if (env.NODE_ENV !== 'test') {
  metricsSnapshotService.startScheduler(env.METRICS_SNAPSHOT_INTERVAL_MINUTES);
  console.log(`📈 Metrics snapshot scheduler initialized (${env.METRICS_SNAPSHOT_INTERVAL_MINUTES} minute interval)`);

  schedule('0 3 * * *', async () => {
    console.log('🕐 Running daily log archive task...');
    try {
      const lockAcquired = await acquireArchiveLock();
      if (!lockAcquired) {
        console.log('⏭️  Skip archive: lock held by another instance or DB unavailable');
        return;
      }
      const result = await logService.archiveOldFiles();
      console.log(`✅ Archive task completed: ${result.archived} files archived, ${result.errors.length} errors`);
    } catch (error) {
      console.error('❌ Archive task failed:', error);
    }
  }, {
    timezone: env.LOG_ARCHIVE_TZ
  });
  console.log(`📅 Log archive scheduler initialized (daily at 03:00 ${env.LOG_ARCHIVE_TZ})`);
}

// Store server instance for graceful shutdown
let server: ReturnType<typeof serve>;

// Graceful shutdown handler
async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`\n${signal} received, starting graceful shutdown...`);

  // Stop metrics scheduler
  metricsSnapshotService.stopScheduler();
  console.log('✅ Metrics scheduler stopped');

  // Close HTTP server (stop accepting new connections)
  if (server) {
    server.close();
    console.log('✅ HTTP server closed');
  }

  // Disconnect from MongoDB
  try {
    await mongoose.disconnect();
    console.log('✅ MongoDB disconnected');
  } catch (err) {
    console.error('❌ Error disconnecting from MongoDB:', err);
  }

  console.log('👋 Graceful shutdown complete');
  process.exit(0);
}

// Register shutdown handlers
process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => void gracefulShutdown('SIGINT'));

server = serve({
  fetch: app.fetch,
  port,
}, (info) => {
  console.log(`🚀 Server running on http://localhost:${info.port}`);
  if (env.NODE_ENV !== 'production') {
    console.log(`📄 API Reference: http://localhost:${info.port}/docs`);
    console.log(`📊 OpenAPI JSON: http://localhost:${info.port}/openapi.json`);
  }
  console.log(`🔗 Health Check: http://localhost:${info.port}/health`);
});
