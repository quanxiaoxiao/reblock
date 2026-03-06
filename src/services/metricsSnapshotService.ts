import { env } from '../config/env';
import { logService, type MetricsSnapshot } from './logService';

interface TransferMinuteBucket {
  minuteStart: number;
  uploadCount: number;
  downloadCount: number;
  uploadBytes: number;
  downloadBytes: number;
  uploadInterruptedCount: number;
  downloadInterruptedCount: number;
}

const ONE_MINUTE_MS = 60 * 1000;

function clampWindowMinutes(windowMinutes: number): number {
  if (!Number.isFinite(windowMinutes)) return 5;
  return Math.max(1, Math.min(60, Math.floor(windowMinutes)));
}

export class MetricsSnapshotService {
  private readonly buckets = new Map<number, TransferMinuteBucket>();
  private timer: NodeJS.Timeout | undefined;

  recordUploadSuccess(bytes: number): void {
    const bucket = this.getCurrentBucket();
    bucket.uploadCount += 1;
    bucket.uploadBytes += Math.max(0, bytes);
  }

  recordDownloadSuccess(bytes: number): void {
    const bucket = this.getCurrentBucket();
    bucket.downloadCount += 1;
    bucket.downloadBytes += Math.max(0, bytes);
  }

  recordUploadInterrupted(): void {
    const bucket = this.getCurrentBucket();
    bucket.uploadInterruptedCount += 1;
  }

  recordDownloadInterrupted(): void {
    const bucket = this.getCurrentBucket();
    bucket.downloadInterruptedCount += 1;
  }

  getCurrentSnapshot(windowMinutes: number = env.METRICS_WINDOW_MINUTES): MetricsSnapshot {
    const safeWindowMinutes = clampWindowMinutes(windowMinutes);
    const now = Date.now();
    const windowStart = this.getWindowStart(now, safeWindowMinutes);

    let uploadCount = 0;
    let downloadCount = 0;
    let uploadBytes = 0;
    let downloadBytes = 0;
    let uploadInterruptedCount = 0;
    let downloadInterruptedCount = 0;

    for (const bucket of this.buckets.values()) {
      if (bucket.minuteStart < windowStart || bucket.minuteStart > now) {
        continue;
      }

      uploadCount += bucket.uploadCount;
      downloadCount += bucket.downloadCount;
      uploadBytes += bucket.uploadBytes;
      downloadBytes += bucket.downloadBytes;
      uploadInterruptedCount += bucket.uploadInterruptedCount;
      downloadInterruptedCount += bucket.downloadInterruptedCount;
    }

    return {
      windowStart,
      windowEnd: now,
      windowMinutes: safeWindowMinutes,
      uploadCount,
      downloadCount,
      uploadBytes,
      downloadBytes,
      uploadInterruptedCount,
      downloadInterruptedCount,
    };
  }

  startScheduler(intervalMinutes: number = env.METRICS_SNAPSHOT_INTERVAL_MINUTES): void {
    const safeIntervalMinutes = clampWindowMinutes(intervalMinutes);

    if (this.timer) {
      return;
    }

    const intervalMs = safeIntervalMinutes * ONE_MINUTE_MS;
    this.timer = setInterval(() => {
      void this.flushSnapshot(safeIntervalMinutes);
    }, intervalMs);

    this.timer.unref();
  }

  stopScheduler(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = undefined;
  }

  async flushSnapshot(windowMinutes: number = env.METRICS_WINDOW_MINUTES): Promise<void> {
    const snapshot = this.getCurrentSnapshot(windowMinutes);

    const hasActivity =
      snapshot.uploadCount > 0 ||
      snapshot.downloadCount > 0 ||
      snapshot.uploadInterruptedCount > 0 ||
      snapshot.downloadInterruptedCount > 0;

    if (!hasActivity) {
      this.compactBuckets();
      return;
    }

    try {
      await logService.logMetricsSnapshot(snapshot);
    } catch (error) {
      console.error('Failed to log metrics snapshot:', error);
    }

    this.compactBuckets();
  }

  private getCurrentBucket(): TransferMinuteBucket {
    const minuteStart = Math.floor(Date.now() / ONE_MINUTE_MS) * ONE_MINUTE_MS;
    const existing = this.buckets.get(minuteStart);
    if (existing) {
      return existing;
    }

    const next: TransferMinuteBucket = {
      minuteStart,
      uploadCount: 0,
      downloadCount: 0,
      uploadBytes: 0,
      downloadBytes: 0,
      uploadInterruptedCount: 0,
      downloadInterruptedCount: 0,
    };

    this.buckets.set(minuteStart, next);
    return next;
  }

  private compactBuckets(): void {
    const now = Date.now();
    const maxWindowMinutes = Math.max(env.METRICS_WINDOW_MINUTES, env.METRICS_SNAPSHOT_INTERVAL_MINUTES, 5);
    const keepAfter = this.getWindowStart(now, maxWindowMinutes * 3);

    for (const [bucketTime] of this.buckets) {
      if (bucketTime < keepAfter) {
        this.buckets.delete(bucketTime);
      }
    }
  }

  private getWindowStart(now: number, windowMinutes: number): number {
    const alignedNow = Math.floor(now / ONE_MINUTE_MS) * ONE_MINUTE_MS;
    return alignedNow - (windowMinutes - 1) * ONE_MINUTE_MS;
  }
}

export const metricsSnapshotService = new MetricsSnapshotService();
