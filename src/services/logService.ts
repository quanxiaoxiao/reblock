import { Types } from 'mongoose';
import { appendFile, mkdir, readdir, rename } from 'fs/promises';
import { join } from 'path';
import { env } from '../config/env';
import { validatePaginationOptionalLimit } from '../utils/pagination';
import {
  LogEntry, 
  LogLevel, 
  LogCategory, 
  IssueStatus, 
  DataLossRisk,
} from '../models/logEntry';
import type { ILogEntry, ILogContext, IStatusHistoryEntry } from '../models/logEntry';

/**
 * LogService
 * 
 * Comprehensive logging service for tracking anomalies.
 * Supports dual storage: MongoDB (for querying) and JSON Lines files (for analysis).
 * 
 * Storage locations:
 * - MongoDB: Primary storage with TTL (90 days)
 * - Files: storage/_logs/issues/YYYY-MM-DD.jsonl
 * 
 * Features:
 * - Duplicate detection (avoid logging same issue within timeframe)
 * - Automatic file rotation (daily)
 * - Archive support (move logs older than 30 days to archive/)
 * - Status tracking (open -> acknowledged -> resolved)
 */

// Log storage configuration
// Use lazy initialization to handle test environment where env might not be loaded
function getLogDir(): string {
  return join(process.cwd(), env.STORAGE_LOG_DIR || './storage/_logs');
}

function getIssuesDir(): string {
  return join(getLogDir(), 'issues');
}

function getActionsDir(): string {
  return join(getLogDir(), 'actions');
}

function getMetricsDir(): string {
  return join(getLogDir(), 'metrics');
}

function getArchiveDir(): string {
  return join(getLogDir(), 'archive');
}

// Archive threshold configuration
const LOG_ARCHIVE_MS = env.LOG_ARCHIVE_DAYS * 24 * 60 * 60 * 1000;

// Limit statusHistory to prevent unbounded growth
const MAX_STATUS_HISTORY = 100;

/**
 * Push to status history with size limit
 */
function pushToStatusHistory(
  history: IStatusHistoryEntry[],
  entry: IStatusHistoryEntry
): void {
  history.push(entry);
  // Keep only the last MAX_STATUS_HISTORY entries
  if (history.length > MAX_STATUS_HISTORY) {
    history.splice(0, history.length - MAX_STATUS_HISTORY);
  }
}

// Interface for log issue parameters
export interface LogIssueParams {
  level: LogLevel;
  category: LogCategory;
  blockId?: string | Types.ObjectId | undefined;
  resourceIds?: (string | Types.ObjectId)[] | undefined;
  entryIds?: (string | Types.ObjectId)[] | undefined;
  details: Record<string, unknown>;
  suggestedAction: string;
  recoverable: boolean;
  dataLossRisk?: DataLossRisk | undefined;
  recoverySteps?: string[] | undefined;
  context?: Partial<ILogContext> | undefined;
}

// Interface for cleanup action parameters
export interface LogCleanupActionParams {
  action: 'soft_delete' | 'fix_linkcount' | 'merge_blocks';
  targetBlockId: string;
  previousState: Record<string, unknown>;
  newState: Record<string, unknown>;
  success: boolean;
  error?: string | undefined;
}

export interface LogActionParams {
  action: string;
  success?: boolean | undefined;
  blockId?: string | Types.ObjectId | undefined;
  resourceIds?: (string | Types.ObjectId)[] | undefined;
  entryIds?: (string | Types.ObjectId)[] | undefined;
  details?: Record<string, unknown> | undefined;
  note?: string | undefined;
  actor?: string | undefined;
  requestId?: string | undefined;
}

export interface MetricsSnapshot {
  windowStart: number;
  windowEnd: number;
  windowMinutes: number;
  uploadCount: number;
  downloadCount: number;
  uploadBytes: number;
  downloadBytes: number;
  uploadInterruptedCount: number;
  downloadInterruptedCount: number;
}

// Interface for log filter
export interface LogFilter {
  category?: LogCategory | undefined;
  level?: LogLevel | undefined;
  status?: IssueStatus | { $ne: IssueStatus } | undefined;
  blockId?: string | undefined;
  detectedBy?: string | undefined;
  fingerprint?: string | undefined;
  errorId?: string | undefined;
  requestId?: string | undefined;
  path?: string | undefined;
  method?: string | undefined;
  errorName?: string | undefined;
  startDate?: Date | undefined;
  endDate?: Date | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
}

// Interface for summary report
export interface LogSummary {
  generatedAt: number;
  totalIssues: number;
  byCategory: Record<LogCategory, number>;
  byLevel: Record<LogLevel, number>;
  byStatus: Record<IssueStatus, number>;
  openIssues: {
    critical: number;
    error: number;
    warning: number;
  };
  recentIssues: ILogEntry[];
  oldestOpenIssue?: ILogEntry | undefined;
}

export class LogService {
  async findById(logId: string): Promise<ILogEntry | null> {
    return LogEntry.findById(logId).exec();
  }

  async findRuntimeErrorById(logId: string): Promise<ILogEntry | null> {
    if (!Types.ObjectId.isValid(logId)) {
      return null;
    }
    return LogEntry.findOne({
      _id: new Types.ObjectId(logId),
      category: LogCategory.RUNTIME_ERROR,
    }).exec();
  }

  async countRecent(days: number, filter?: LogFilter): Promise<number> {
    const query = this.buildRecentQuery(days, filter);
    return LogEntry.countDocuments(query);
  }

  /**
   * Log an issue detected in the system
   * Stores in both MongoDB and file system
   */
  async logIssue(params: LogIssueParams): Promise<ILogEntry> {
    const now = Date.now();
    const fingerprint = typeof params.details?.['fingerprint'] === 'string' ? params.details['fingerprint'] : undefined;
    const dedupWindowMinutes = Number.isFinite(env.LOG_DEDUP_WINDOW_MINUTES) ? env.LOG_DEDUP_WINDOW_MINUTES : 10;
    const dedupWindowMs = Math.max(1, dedupWindowMinutes) * 60 * 1000;

    // Runtime errors can be noisy. Aggregate repeated issues with the same fingerprint in short windows.
    if (params.category === LogCategory.RUNTIME_ERROR && fingerprint) {
      const existing = await LogEntry.findOneAndUpdate(
        {
          category: params.category,
          fingerprint,
          status: { $in: [IssueStatus.OPEN, IssueStatus.ACKNOWLEDGED] },
          timestamp: { $gte: now - dedupWindowMs },
        },
        {
          $set: {
            timestamp: now,
            lastSeenAt: now,
            details: params.details,
            context: {
              detectedBy: params.context?.detectedBy || 'system',
              detectedAt: now,
              scriptVersion: params.context?.scriptVersion,
              serverVersion: params.context?.serverVersion,
              environment: params.context?.environment || this.getEnvironment(),
              originalCreatedAt: params.context?.originalCreatedAt,
              daysSinceCreation: params.context?.daysSinceCreation,
              lastAccessedAt: params.context?.lastAccessedAt,
              stackTrace: params.context?.stackTrace,
              requestId: params.context?.requestId,
              userAgent: params.context?.userAgent,
            },
          },
          $inc: { occurrenceCount: 1 },
        },
        { returnDocument: 'after' }
      );

      if (existing) {
        await this.writeToFile(existing, 'issues');
        return existing;
      }
    }

    // Build the log entry
    const entry = new LogEntry({
      timestamp: now,
      level: params.level,
      category: params.category,
      blockId: params.blockId ? new Types.ObjectId(params.blockId) : undefined,
      resourceIds: params.resourceIds?.map(id => new Types.ObjectId(id)),
      entryIds: params.entryIds?.map(id => new Types.ObjectId(id)),
      details: params.details,
      fingerprint,
      occurrenceCount: 1,
      firstSeenAt: now,
      lastSeenAt: now,
      suggestedAction: params.suggestedAction,
      recoverable: params.recoverable,
      dataLossRisk: params.dataLossRisk || DataLossRisk.NONE,
      recoverySteps: params.recoverySteps,
      context: {
        detectedBy: params.context?.detectedBy || 'system',
        detectedAt: now,
        scriptVersion: params.context?.scriptVersion,
        serverVersion: params.context?.serverVersion,
        environment: params.context?.environment || this.getEnvironment(),
        originalCreatedAt: params.context?.originalCreatedAt,
        daysSinceCreation: params.context?.daysSinceCreation,
        lastAccessedAt: params.context?.lastAccessedAt,
        stackTrace: params.context?.stackTrace,
        requestId: params.context?.requestId,
        userAgent: params.context?.userAgent,
      },
      status: IssueStatus.OPEN,
    });

    // Pre-compute file location so we only need a single save
    const date = new Date().toISOString().slice(0, 10);
    const dir = getIssuesDir();
    const filePath = join(dir, `${date}.jsonl`);
    entry.fileLocation = { date, filePath };

    // Save to MongoDB (single write)
    await entry.save();

    // Write to file (does not save to DB again)
    await this.writeToFileOnly(entry, dir, filePath);

    return entry;
  }

  /**
   * Log a cleanup action for audit purposes
   */
  async logCleanupAction(params: LogCleanupActionParams): Promise<ILogEntry> {
    const now = Date.now();
    const entry = new LogEntry({
      timestamp: now,
      level: params.success ? LogLevel.INFO : LogLevel.ERROR,
      category: params.success ? LogCategory.CLEANUP_ACTION : LogCategory.CLEANUP_ERROR,
      blockId: new Types.ObjectId(params.targetBlockId),
      details: {
        action: params.action,
        previousState: params.previousState,
        newState: params.newState,
        error: params.error,
      },
      suggestedAction: params.success ? 'Action completed successfully' : 'Review error and retry',
      recoverable: !params.success,
      dataLossRisk: params.success ? DataLossRisk.NONE : DataLossRisk.LOW,
      context: {
        detectedBy: 'cleanup',
        detectedAt: now,
        environment: this.getEnvironment(),
      },
      status: IssueStatus.RESOLVED,
      resolvedAt: now,
      resolution: params.success ? 'Cleanup action executed' : `Failed: ${params.error}`,
      resolvedBy: 'cleanup-script',
    });

    await entry.save();
    await this.writeToFile(entry, 'actions');

    return entry;
  }

  /**
   * Log a generic resolved action entry for audit trails.
   */
  async logAction(params: LogActionParams): Promise<ILogEntry> {
    const now = Date.now();
    const success = params.success !== false;

    const entry = new LogEntry({
      timestamp: now,
      level: success ? LogLevel.INFO : LogLevel.ERROR,
      category: success ? LogCategory.CLEANUP_ACTION : LogCategory.CLEANUP_ERROR,
      blockId: params.blockId ? new Types.ObjectId(params.blockId) : undefined,
      resourceIds: params.resourceIds?.map(id => new Types.ObjectId(id)),
      entryIds: params.entryIds?.map(id => new Types.ObjectId(id)),
      details: {
        action: params.action,
        ...(params.details || {}),
      },
      suggestedAction: success ? 'Action completed successfully' : 'Review action failure and retry',
      recoverable: !success,
      dataLossRisk: success ? DataLossRisk.NONE : DataLossRisk.LOW,
      context: {
        detectedBy: 'system',
        detectedAt: now,
        environment: this.getEnvironment(),
        requestId: params.requestId,
      },
      status: IssueStatus.RESOLVED,
      resolvedAt: now,
      resolution: params.note || (success ? 'Action executed' : 'Action failed'),
      resolvedBy: params.actor || 'system',
    });

    await entry.save();
    await this.writeToFile(entry, 'actions');

    return entry;
  }

  /**
   * Log aggregated runtime transfer metrics snapshot
   */
  async logMetricsSnapshot(snapshot: MetricsSnapshot): Promise<ILogEntry> {
    const now = Date.now();
    const entry = new LogEntry({
      timestamp: now,
      level: LogLevel.INFO,
      category: LogCategory.METRICS_SNAPSHOT,
      details: snapshot,
      suggestedAction: 'Metrics snapshot recorded',
      recoverable: false,
      dataLossRisk: DataLossRisk.NONE,
      context: {
        detectedBy: 'system',
        detectedAt: now,
        environment: this.getEnvironment(),
      },
      status: IssueStatus.RESOLVED,
      resolvedAt: now,
      resolution: 'Snapshot saved',
      resolvedBy: 'metrics-scheduler',
    });

    await entry.save();
    await this.writeToFile(entry, 'metrics');

    return entry;
  }

  /**
   * Check if a similar issue has been logged recently
   * Prevents duplicate logging within specified hours
   */
  async checkDuplicate(
    category: LogCategory,
    blockId: string | Types.ObjectId,
    sinceHours: number = 24
  ): Promise<boolean> {
    const since = Date.now() - sinceHours * 60 * 60 * 1000;
    
    const existing = await LogEntry.findOne({
      category,
      blockId: new Types.ObjectId(blockId),
      timestamp: { $gte: since },
    });

    return !!existing;
  }

  /**
   * Find all logs for a specific block
   */
  async findByBlockId(blockId: string, limit: number = 50): Promise<ILogEntry[]> {
    // Validate limit: 1-200
    const validatedLimit = Math.max(1, Math.min(200, Math.floor(limit)));
    return LogEntry.find({ blockId: new Types.ObjectId(blockId) })
      .sort({ timestamp: -1 })
      .limit(validatedLimit)
      .exec();
  }

  /**
   * Find all logs for a specific entry
   */
  async findByEntryId(entryId: string, limit: number = 50): Promise<ILogEntry[]> {
    // Validate limit: 1-200
    const validatedLimit = Math.max(1, Math.min(200, Math.floor(limit)));
    return LogEntry.find({ entryIds: new Types.ObjectId(entryId) })
      .sort({ timestamp: -1 })
      .limit(validatedLimit)
      .exec();
  }

  /**
   * Find open issues, optionally filtered by category.
   * Hard-capped at 1000 results to prevent OOM on large datasets.
   */
  async findOpenIssues(category?: LogCategory, limit: number = 200): Promise<ILogEntry[]> {
    const filter: Record<string, unknown> = { status: IssueStatus.OPEN };
    if (category) {
      filter['category'] = category;
    }
    const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
    
    return LogEntry.find(filter)
      .sort({ timestamp: -1 })
      .limit(safeLimit)
      .exec();
  }

  /**
   * Find logs within date range
   */
  async findRecent(days: number, filter?: LogFilter): Promise<ILogEntry[]> {
    const query = this.buildRecentQuery(days, filter);

    // Validate pagination parameters (limit: 1-200 optional, offset: 0-100000)
    const { limit, offset } = validatePaginationOptionalLimit({
      limit: filter?.limit,
      offset: filter?.offset
    });

    const dbQuery = LogEntry.find(query)
      .sort({ timestamp: filter?.sortOrder === 'asc' ? 1 : -1 })
      .skip(offset);

    if (typeof limit === 'number') {
      dbQuery.limit(limit);
    }

    return dbQuery.exec();
  }

  private buildRecentQuery(days: number, filter?: LogFilter): Record<string, unknown> {
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const startTs = filter?.startDate?.getTime();
    const endTs = filter?.endDate?.getTime();

    const query: Record<string, unknown> = {
      timestamp: {
        $gte: typeof startTs === 'number' ? startTs : since,
        ...(typeof endTs === 'number' ? { $lte: endTs } : {}),
      },
    };

    if (filter?.category) query['category'] = filter.category;
    if (filter?.level) query['level'] = filter.level;
    if (filter?.status) query['status'] = filter.status;
    if (filter?.blockId) query['blockId'] = new Types.ObjectId(filter.blockId);
    if (filter?.detectedBy) query['context.detectedBy'] = filter.detectedBy;
    if (filter?.fingerprint) query['fingerprint'] = filter.fingerprint;
    if (filter?.errorId) query['details.errorId'] = filter.errorId;
    if (filter?.requestId) {
      query['$or'] = [
        { 'context.requestId': filter.requestId },
        { 'details.requestId': filter.requestId },
      ];
    }
    if (filter?.path) query['details.path'] = filter.path;
    if (filter?.method) query['details.method'] = filter.method;
    if (filter?.errorName) query['details.errorName'] = filter.errorName;

    return query;
  }

  /**
   * Mark an issue as resolved
   */
  async markResolved(
    logId: string,
    resolution: string,
    resolvedBy: string = 'system'
  ): Promise<void> {
    const entry = await LogEntry.findById(logId);
    if (!entry) {
      throw new Error(`Log entry not found: ${logId}`);
    }

    // Add to status history
    const historyEntry = {
      status: entry.status,
      changedAt: Date.now(),
      changedBy: resolvedBy,
      note: 'Marked as resolved',
    };

    entry.statusHistory = entry.statusHistory || [];
    pushToStatusHistory(entry.statusHistory, historyEntry);

    // Update status
    entry.status = IssueStatus.RESOLVED;
    entry.resolvedAt = Date.now();
    entry.resolution = resolution;
    entry.resolvedBy = resolvedBy;

    await entry.save();
  }

  /**
   * Mark an issue as acknowledged
   */
  async markAcknowledged(logId: string, note?: string): Promise<void> {
    const entry = await LogEntry.findById(logId);
    if (!entry) {
      throw new Error(`Log entry not found: ${logId}`);
    }

    const historyEntry = {
      status: entry.status,
      changedAt: Date.now(),
      note: note || 'Acknowledged',
    };

    entry.statusHistory = entry.statusHistory || [];
    pushToStatusHistory(entry.statusHistory, historyEntry);
    entry.status = IssueStatus.ACKNOWLEDGED;

    await entry.save();
  }

  /**
   * Generate comprehensive summary report
   */
  async generateSummary(): Promise<LogSummary> {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    // Aggregate statistics
    const [
      totalIssues,
      byCategory,
      byLevel,
      byStatus,
      openCritical,
      openError,
      openWarning,
      recentIssues,
      oldestOpen,
    ] = await Promise.all([
      LogEntry.countDocuments(),
      this.aggregateByField('category'),
      this.aggregateByField('level'),
      this.aggregateByField('status'),
      LogEntry.countDocuments({ status: IssueStatus.OPEN, level: LogLevel.CRITICAL }),
      LogEntry.countDocuments({ status: IssueStatus.OPEN, level: LogLevel.ERROR }),
      LogEntry.countDocuments({ status: IssueStatus.OPEN, level: LogLevel.WARNING }),
      LogEntry.find({ timestamp: { $gte: oneDayAgo } })
        .sort({ timestamp: -1 })
        .limit(10)
        .exec(),
      LogEntry.findOne({ status: IssueStatus.OPEN })
        .sort({ timestamp: 1 })
        .exec(),
    ]);

    return {
      generatedAt: now,
      totalIssues,
      byCategory: byCategory as Record<LogCategory, number>,
      byLevel: byLevel as Record<LogLevel, number>,
      byStatus: byStatus as Record<IssueStatus, number>,
      openIssues: {
        critical: openCritical,
        error: openError,
        warning: openWarning,
      },
      recentIssues,
      oldestOpenIssue: oldestOpen || undefined,
    };
  }

  /**
   * Write log entry to JSON Lines file and update its fileLocation in DB.
   * Used by methods that don't pre-set fileLocation before the initial save.
   */
  private async writeToFile(entry: ILogEntry, subdir: 'issues' | 'actions' | 'metrics'): Promise<void> {
    try {
      const date = new Date().toISOString().slice(0, 10);
      const dir = subdir === 'issues' ? getIssuesDir() : subdir === 'actions' ? getActionsDir() : getMetricsDir();
      const filePath = join(dir, `${date}.jsonl`);

      await this.writeToFileOnly(entry, dir, filePath);

      // Update entry with file location (only if not already set)
      if (!entry.fileLocation?.filePath) {
        entry.fileLocation = { date, filePath };
        await entry.save();
      }
    } catch (error) {
      // File write failure should not break the main flow
      console.error('Failed to write log to file:', error);
    }
  }

  /**
   * Write log entry to a specific JSONL file without updating DB.
   * Used when fileLocation is pre-set before the initial save to avoid double-save.
   */
  private async writeToFileOnly(entry: ILogEntry, dir: string, filePath: string): Promise<void> {
    try {
      await mkdir(dir, { recursive: true });
      const fileEntry = this.serializeForFile(entry);
      const line = JSON.stringify(fileEntry) + '\n';
      await appendFile(filePath, line, 'utf-8');
    } catch (error) {
      console.error('Failed to write log to file:', error);
    }
  }

  /**
   * Serialize log entry for file storage
   * Converts ObjectIds to strings for readability
   */
  private serializeForFile(entry: ILogEntry): Record<string, unknown> {
    const obj = entry.toObject() as Record<string, unknown> & {
      _id: { toString(): string };
      blockId?: { toString(): string };
      resourceIds?: Array<{ toString(): string }>;
      entryIds?: Array<{ toString(): string }>;
      actualState?: Record<string, unknown> & {
        duplicateBlocks?: Array<{ toString(): string }>;
      };
    };
    
    return {
      ...obj,
      _id: obj._id.toString(),
      blockId: obj.blockId?.toString(),
      resourceIds: obj.resourceIds?.map((id) => id.toString()),
      entryIds: obj.entryIds?.map((id) => id.toString()),
      actualState: obj.actualState ? {
        ...obj.actualState,
        duplicateBlocks: obj.actualState.duplicateBlocks?.map((id) => id.toString()),
      } : undefined,
    };
  }

  /**
   * Aggregate counts by field
   */
  private async aggregateByField(field: string): Promise<Record<string, number>> {
    const results = await LogEntry.aggregate([
      { $group: { _id: `$${field}`, count: { $sum: 1 } } },
    ]);

    return results.reduce((acc, curr) => {
      acc[curr._id] = curr.count;
      return acc;
    }, {} as Record<string, number>);
  }

  /**
   * Get current environment
   */
  private getEnvironment(): 'development' | 'production' | 'test' {
    const nodeEnv = process.env['NODE_ENV'];
    if (nodeEnv === 'production') return 'production';
    if (nodeEnv === 'test') return 'test';
    return 'development';
  }

  /**
   * Find and resolve open issues by blockId and category
   * Used by cleanup script to auto-close resolved issues
   * Performance optimized: uses updateMany for true bulk update
   */
  async resolveIssuesByBlockId(
    blockId: string,
    category: LogCategory,
    resolution: string,
    resolvedBy: string = 'cleanup-script'
  ): Promise<{ resolved: number; errors: string[] }> {
    const errors: string[] = [];

    try {
      const now = Date.now();
      const filter = {
        blockId: new Types.ObjectId(blockId),
        category,
        status: IssueStatus.OPEN,
      };

      const result = await LogEntry.updateMany(filter, {
        $set: {
          status: IssueStatus.RESOLVED,
          resolvedAt: now,
          resolution,
          resolvedBy,
        },
        $push: {
          statusHistory: {
            $each: [{
              status: IssueStatus.OPEN,
              changedAt: now,
              changedBy: resolvedBy,
              note: 'Auto-resolved by cleanup action',
            }],
            $slice: -MAX_STATUS_HISTORY,
          },
        },
      });

      return { resolved: result.modifiedCount, errors };
    } catch (error) {
      errors.push(`Failed to resolve issues for block ${blockId}: ${error}`);
      return { resolved: 0, errors };
    }
  }

  /**
   * Archive old log files (move files older than LOG_ARCHIVE_DAYS to archive/)
   * Should be called periodically (e.g., daily via cron)
   * 
   * Performance optimized: batch file operations
   */
  async archiveOldFiles(): Promise<{ archived: number; errors: string[] }> {
    const archiveThreshold = Date.now() - LOG_ARCHIVE_MS;
    const errors: string[] = [];
    let archived = 0;

    try {
      // Ensure archive directory exists
      await mkdir(getArchiveDir(), { recursive: true });

      // Process both issues and actions directories
      const dirs = [getIssuesDir(), getActionsDir(), getMetricsDir()];
      
      for (const dir of dirs) {
        try {
          const files = await readdir(dir);
          
          for (const file of files) {
            // Parse date from filename (YYYY-MM-DD.jsonl)
            const dateMatch = file.match(/^(\d{4})-(\d{2})-(\d{2})\.jsonl$/);
            if (!dateMatch) continue;

            const [, year = '', month = '', day = ''] = dateMatch;
            const fileDate = new Date(`${year}-${month}-${day}`).getTime();
            
            // Check if file is older than threshold
            if (fileDate < archiveThreshold) {
              const sourcePath = join(dir, file);
              const monthDir = join(getArchiveDir(), year, month);
              
              // Create month directory if not exists
              await mkdir(monthDir, { recursive: true });
              
              const destPath = join(monthDir, file);
              
              try {
                await rename(sourcePath, destPath);
                archived++;
              } catch (moveError) {
                errors.push(`Failed to move ${file}: ${moveError}`);
              }
            }
          }
        } catch (dirError) {
          // Directory might not exist yet, skip
          if ((dirError as NodeJS.ErrnoException).code !== 'ENOENT') {
            errors.push(`Failed to read directory ${dir}: ${dirError}`);
          }
        }
      }

      console.log(`Archived ${archived} log files (threshold: ${archiveThreshold})`);
      
      // Log archive action
      if (archived > 0 || errors.length > 0) {
        const archiveLogEntry = new LogEntry({
          timestamp: Date.now(),
          level: errors.length > 0 ? LogLevel.WARNING : LogLevel.INFO,
          category: LogCategory.CLEANUP_ACTION,
          details: {
            action: 'archive_old_logs',
            archivedCount: archived,
            errorCount: errors.length,
            threshold: archiveThreshold,
          },
          suggestedAction: errors.length > 0 ? 'Check archive errors and retry' : 'Archive completed successfully',
          recoverable: errors.length > 0,
          dataLossRisk: DataLossRisk.NONE,
          context: {
            detectedBy: 'system',
            detectedAt: Date.now(),
            environment: this.getEnvironment(),
          },
          status: IssueStatus.RESOLVED,
          resolvedAt: Date.now(),
          resolution: `Archived ${archived} files${errors.length > 0 ? ` with ${errors.length} errors` : ''}`,
          resolvedBy: 'archive-script',
        });
        
        await archiveLogEntry.save();
        await this.writeToFile(archiveLogEntry, 'actions');
      }
    } catch (error) {
      errors.push(`Failed to archive files: ${error}`);
    }

    return { archived, errors };
  }
}

// Export singleton instance
export const logService = new LogService();
