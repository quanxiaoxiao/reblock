import { serve } from '@hono/node-server';
import app, { connectDatabase } from './app';
import { env } from './config/env';
import { schedule } from 'node-cron';
import mongoose from 'mongoose';
import { randomUUID } from 'crypto';
import { logService } from './services/logService';
import { metricsSnapshotService } from './services/metricsSnapshotService';
import { entryRetentionScheduler } from './services/entryRetentionScheduler';

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

if (env.RETENTION_SCHEDULER_ENABLED) {
  entryRetentionScheduler.startScheduler(
    env.RETENTION_SCHEDULER_INTERVAL_MS,
    env.RETENTION_SCHEDULER_LIMIT,
    env.RETENTION_SCHEDULER_LOCK_TTL_MS
  );
  console.log(`🧹 Entry retention scheduler initialized (${env.RETENTION_SCHEDULER_INTERVAL_MS} ms interval)`);
}

// Store server instance for graceful shutdown
let server: ReturnType<typeof serve>;

// Graceful shutdown handler
async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`\n${signal} received, starting graceful shutdown...`);

  // Force exit after 10 seconds if graceful shutdown hangs
  const forceExitTimer = setTimeout(() => {
    console.error('❌ Graceful shutdown timed out after 10s, forcing exit');
    process.exit(1);
  }, 10_000);
  forceExitTimer.unref();

  // Stop metrics scheduler
  metricsSnapshotService.stopScheduler();
  console.log('✅ Metrics scheduler stopped');

  entryRetentionScheduler.stopScheduler();
  console.log('✅ Entry retention scheduler stopped');

  // Close HTTP server and wait for in-flight requests to finish
  if (server) {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
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
  clearTimeout(forceExitTimer);
  process.exit(0);
}

// Register shutdown handlers
process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => void gracefulShutdown('SIGINT'));

// Connect to MongoDB first, then start the HTTP server
(async () => {
  try {
    await connectDatabase();
  } catch (err) {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  }

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
})();
