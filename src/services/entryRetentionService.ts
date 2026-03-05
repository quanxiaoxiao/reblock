import { Entry, Resource } from '../models';
import { logService } from './logService';
import { resourceService } from './resourceService';

export interface EntryRetentionRunOnceResult {
  scannedEntries: number;
  expiredCandidates: number;
  deleted: number;
  failed: number;
  limit: number;
  triggeredAt: number;
}

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 10000;

function normalizeLimit(limit?: number): number {
  if (!Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit as number)));
}

export class EntryRetentionService {
  async runOnce(limit?: number): Promise<EntryRetentionRunOnceResult> {
    const normalizedLimit = normalizeLimit(limit);
    const triggeredAt = Date.now();
    let expiredCandidates = 0;
    let deleted = 0;
    let failed = 0;

    const retentionEntries = await Entry.find({
      isInvalid: { $ne: true },
      'uploadConfig.retentionMs': { $gt: 0 },
    }, {
      _id: 1,
      uploadConfig: 1,
    }).lean();

    const scannedEntries = retentionEntries.length;

    for (const entry of retentionEntries) {
      const retentionMs = Number(entry.uploadConfig?.retentionMs);
      if (!Number.isFinite(retentionMs) || retentionMs <= 0) {
        continue;
      }

      const remaining = normalizedLimit - expiredCandidates;
      if (remaining <= 0) {
        break;
      }

      const cutoffAt = triggeredAt - retentionMs;
      const candidates = await Resource.find({
        entry: entry._id,
        isInvalid: { $ne: true },
        createdAt: { $lte: cutoffAt },
      }, {
        _id: 1,
        createdAt: 1,
      })
        .sort({ createdAt: 1, _id: 1 })
        .limit(remaining)
        .lean();

      expiredCandidates += candidates.length;

      for (const candidate of candidates) {
        const resourceId = candidate._id.toString();
        try {
          const removed = await resourceService.delete(resourceId);
          if (removed) {
            deleted += 1;
            await logService.logAction({
              action: 'entry_retention_delete_resource',
              success: true,
              entryIds: [entry._id.toString()],
              resourceIds: [resourceId],
              details: {
                retentionMs,
                cutoffAt,
                triggeredAt,
                resourceCreatedAt: candidate.createdAt,
              },
              note: 'Resource removed by entry retention scheduler',
              actor: 'retention-service',
            });
            continue;
          }

          failed += 1;
          await logService.logAction({
            action: 'entry_retention_delete_resource',
            success: false,
            entryIds: [entry._id.toString()],
            resourceIds: [resourceId],
            details: {
              retentionMs,
              cutoffAt,
              triggeredAt,
              reason: 'resource already deleted or missing',
            },
            note: 'Retention deletion target not found',
            actor: 'retention-service',
          });
        } catch (error: unknown) {
          failed += 1;
          await logService.logAction({
            action: 'entry_retention_delete_resource',
            success: false,
            entryIds: [entry._id.toString()],
            resourceIds: [resourceId],
            details: {
              retentionMs,
              cutoffAt,
              triggeredAt,
              error: error instanceof Error ? error.message : String(error),
            },
            note: 'Retention deletion failed',
            actor: 'retention-service',
          });
        }
      }
    }

    const summary: EntryRetentionRunOnceResult = {
      scannedEntries,
      expiredCandidates,
      deleted,
      failed,
      limit: normalizedLimit,
      triggeredAt,
    };

    await logService.logAction({
      action: 'entry_retention_run_once',
      success: failed === 0,
      details: summary,
      note: 'Entry retention scheduled cleanup completed',
      actor: 'retention-service',
    });

    return summary;
  }
}

export const entryRetentionService = new EntryRetentionService();
