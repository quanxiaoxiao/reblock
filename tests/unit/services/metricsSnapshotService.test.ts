import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MetricsSnapshotService } from '../../../src/services/metricsSnapshotService';
import { logService } from '../../../src/services/logService';

vi.mock('../../../src/config/env', () => ({
  env: {
    METRICS_WINDOW_MINUTES: 5,
    METRICS_SNAPSHOT_INTERVAL_MINUTES: 5,
  },
}));

vi.mock('../../../src/services/logService', () => ({
  logService: {
    logMetricsSnapshot: vi.fn().mockResolvedValue({}),
  },
}));

describe('MetricsSnapshotService', () => {
  let service: MetricsSnapshotService;

  beforeEach(() => {
    service = new MetricsSnapshotService();
    vi.clearAllMocks();
  });

  it('aggregates upload and download metrics in current window', () => {
    service.recordUploadSuccess(128);
    service.recordUploadSuccess(256);
    service.recordDownloadSuccess(512);
    service.recordUploadInterrupted();
    service.recordDownloadInterrupted();

    const snapshot = service.getCurrentSnapshot(5);

    expect(snapshot.uploadCount).toBe(2);
    expect(snapshot.downloadCount).toBe(1);
    expect(snapshot.uploadBytes).toBe(384);
    expect(snapshot.downloadBytes).toBe(512);
    expect(snapshot.uploadInterruptedCount).toBe(1);
    expect(snapshot.downloadInterruptedCount).toBe(1);
  });

  it('flushes active metrics snapshot to log service', async () => {
    service.recordUploadSuccess(1024);

    await service.flushSnapshot(5);

    expect(logService.logMetricsSnapshot).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(logService.logMetricsSnapshot).mock.calls[0][0];
    expect(payload.uploadCount).toBe(1);
    expect(payload.uploadBytes).toBe(1024);
  });

  it('does not flush when there is no activity', async () => {
    await service.flushSnapshot(5);
    expect(logService.logMetricsSnapshot).not.toHaveBeenCalled();
  });
});
