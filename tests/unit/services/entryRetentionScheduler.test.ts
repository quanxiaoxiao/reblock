import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EntryRetentionScheduler } from '../../../src/services/entryRetentionScheduler';
import { entryRetentionService } from '../../../src/services/entryRetentionService';

vi.mock('../../../src/services/entryRetentionService', () => ({
  entryRetentionService: {
    runOnce: vi.fn().mockResolvedValue({
      scannedEntries: 0,
      expiredCandidates: 0,
      deleted: 0,
      failed: 0,
      limit: 1000,
      triggeredAt: Date.now(),
    }),
  },
}));

vi.mock('../../../src/services/logService', () => ({
  logService: {
    logAction: vi.fn().mockResolvedValue({}),
  },
}));

describe('EntryRetentionScheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs cleanup when lock is acquired', async () => {
    const scheduler = new EntryRetentionScheduler();
    vi.spyOn(scheduler as any, 'acquireLock').mockResolvedValue(true);

    await (scheduler as any).tick(123, 1000);

    expect(entryRetentionService.runOnce).toHaveBeenCalledWith(123);
  });

  it('skips cleanup when lock is not acquired', async () => {
    const scheduler = new EntryRetentionScheduler();
    vi.spyOn(scheduler as any, 'acquireLock').mockResolvedValue(false);

    await (scheduler as any).tick(123, 1000);

    expect(entryRetentionService.runOnce).not.toHaveBeenCalled();
  });

  it('starts and stops interval scheduler', async () => {
    vi.useFakeTimers();
    const scheduler = new EntryRetentionScheduler();
    const tickSpy = vi.spyOn(scheduler as any, 'tick').mockResolvedValue(undefined);

    scheduler.startScheduler(1000, 10, 1000);
    expect(tickSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2200);
    expect(tickSpy.mock.calls.length).toBeGreaterThanOrEqual(3);

    scheduler.stopScheduler();
    const callsBefore = tickSpy.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2200);
    expect(tickSpy).toHaveBeenCalledTimes(callsBefore);
    vi.useRealTimers();
  });
});
