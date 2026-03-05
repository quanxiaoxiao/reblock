import { randomUUID } from 'crypto';
import mongoose from 'mongoose';
import { env } from '../config/env';
import { entryRetentionService } from './entryRetentionService';
import { logService } from './logService';

function clampPositiveInt(value: number, fallback: number, min: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.floor(value));
}

export class EntryRetentionScheduler {
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly lockKey = 'entry_retention_scheduler';
  private readonly lockOwner = `${process.pid}-${randomUUID()}`;
  private lockIndexEnsured = false;

  startScheduler(
    intervalMs: number = env.RETENTION_SCHEDULER_INTERVAL_MS,
    limit: number = env.RETENTION_SCHEDULER_LIMIT,
    lockTtlMs: number = env.RETENTION_SCHEDULER_LOCK_TTL_MS
  ): void {
    if (this.timer) {
      return;
    }

    const safeIntervalMs = clampPositiveInt(intervalMs, 300000, 1000);
    const safeLimit = clampPositiveInt(limit, 1000, 1);
    const safeLockTtlMs = clampPositiveInt(lockTtlMs, 600000, safeIntervalMs);

    this.timer = setInterval(() => {
      void this.tick(safeLimit, safeLockTtlMs);
    }, safeIntervalMs);
    this.timer.unref();

    // Trigger once on startup so long-running stale resources don't wait for the first interval.
    void this.tick(safeLimit, safeLockTtlMs);
  }

  stopScheduler(): void {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private async tick(limit: number, lockTtlMs: number): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      const lockAcquired = await this.acquireLock(lockTtlMs);
      if (!lockAcquired) {
        return;
      }

      await entryRetentionService.runOnce(limit);
    } catch (error: unknown) {
      console.error('❌ Entry retention scheduler tick failed:', error);
      try {
        await logService.logAction({
          action: 'entry_retention_scheduler_tick',
          success: false,
          details: {
            error: error instanceof Error ? error.message : String(error),
          },
          note: 'Entry retention scheduler tick failed',
          actor: 'retention-scheduler',
        });
      } catch {
        // Ignore log write failures to avoid cascading scheduler errors.
      }
    } finally {
      this.running = false;
    }
  }

  private async ensureLockIndex(): Promise<void> {
    if (this.lockIndexEnsured) {
      return;
    }

    const db = mongoose.connection.db;
    if (!db) {
      return;
    }

    await db.collection('_schedulerLocks').createIndex({ key: 1 }, { unique: true });
    this.lockIndexEnsured = true;
  }

  private async acquireLock(lockTtlMs: number): Promise<boolean> {
    const db = mongoose.connection.db;
    if (!db) {
      return false;
    }

    await this.ensureLockIndex();

    const now = new Date();
    const expiresAt = new Date(now.getTime() + lockTtlMs);

    try {
      const result = await db.collection('_schedulerLocks').findOneAndUpdate(
        {
          key: this.lockKey,
          $or: [{ expiresAt: { $lte: now } }, { owner: this.lockOwner }],
        },
        {
          $set: {
            key: this.lockKey,
            owner: this.lockOwner,
            acquiredAt: now,
            expiresAt,
          },
        },
        { upsert: true, returnDocument: 'after' }
      );

      const owner = (result as { owner?: string; value?: { owner?: string } } | null)?.owner
        || (result as { owner?: string; value?: { owner?: string } } | null)?.value?.owner;

      return owner === this.lockOwner;
    } catch (error: unknown) {
      const err = error as { code?: number };
      if (err?.code === 11000) {
        return false;
      }
      throw error;
    }
  }
}

export const entryRetentionScheduler = new EntryRetentionScheduler();
