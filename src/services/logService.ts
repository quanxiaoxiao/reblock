import { Types } from 'mongoose';
import { appendFile, mkdir, readdir, rename } from 'fs/promises';
import { join } from 'path';
import { env } from '../config/env';
import { 
  LogEntry, 
  ILogEntry, 
  LogLevel, 
  LogCategory, 
  IssueStatus, 
  DataLossRisk,
  ILogContext,
} from '../models/logEntry';

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

// Interface for log issue parameters
export interface LogIssueParams {
  level: LogLevel;
  category: LogCategory;
  blockId?: string | Types.ObjectId;
  resourceIds?: (string | Types.ObjectId)[];
  entryIds?: (string | Types.ObjectId)[];
  details: Record<string, any>;
  suggestedAction: string;
  recoverable: boolean;
  dataLossRisk?: DataLossRisk;
  recoverySteps?: string[];
  context?: Partial<ILogContext>;
}

// Interface for cleanup action parameters
export interface LogCleanupActionParams {
  action: 'soft_delete' | 'fix_linkcount' | 'merge_blocks';
  targetBlockId: string;
  previousState: Record<string, any>;
  newState: Record<string, any>;
  success: boolean;
  error?: string;
}

export interface LogActionParams {
  action: string;
  success?: boolean;
  blockId?: string | Types.ObjectId;
  resourceIds?: (string | Types.ObjectId)[];
  entryIds?: (string | Types.ObjectId)[];
  details?: Record<string, any>;
  note?: string;
  actor?: string;
  requestId?: string;
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
  category?: LogCategory;
  level?: LogLevel;
  status?: IssueStatus;
  blockId?: string;
  detectedBy?: string;
  fingerprint?: string;
  errorId?: string;
  requestId?: string;
  path?: string;
  method?: string;
  errorName?: string;
  startDate?: Date;
  endDate?: Date;
  sortOrder?: 'asc' | 'desc';
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
  oldestOpenIssue?: ILogEntry;
}

export class LogService {
  /**
   * Log an issue detected in the system
   * Stores in both MongoDB and file system
   */
  async logIssue(params: LogIssueParams): Promise<ILogEntry> {
    const now = Date.now();
    const fingerprint = typeof params.details?.fingerprint === 'string' ? params.details.fingerprint : undefined;
    const dedupWindowMinutes = Number.isFinite(env.LOG_DEDUP_WINDOW_MINUTES) ? env.LOG_DEDUP_WINDOW_MINUTES : 10;
    const dedupWindowMs = Math.max(1, dedupWindowMinutes) * 60 * 1000;

    // Runtime errors can be noisy. Aggregate repeated issues with the same fingerprint in short windows.
    if (params.category === LogCategory.RUNTIME_ERROR && fingerprint) {
      const existing = await LogEntry.findOne({
        category: params.category,
        fingerprint,
        status: { $in: [IssueStatus.OPEN, IssueStatus.ACKNOWLEDGED] },
        timestamp: { $gte: now - dedupWindowMs },
      });

      if (existing) {
        existing.timestamp = now;
        existing.lastSeenAt = now;
        existing.occurrenceCount = (existing.occurrenceCount || 1) + 1;
        existing.details = {
          ...existing.details,
          latest: params.details,
        };
        existing.context = {
          ...existing.context,
          detectedAt: now,
          requestId: params.context?.requestId || existing.context.requestId,
          userAgent: params.context?.userAgent || existing.context.userAgent,
        };

        await existing.save();
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

    // Save to MongoDB
    await entry.save();

    // Write to file
    await this.writeToFile(entry, 'issues');

    return entry;
  }

  /**
   * Log a cleanup action for audit purposes
   */
  async logCleanupAction(params: LogCleanupActionParams): Promise<ILogEntry> {
    const entry = new LogEntry({
      timestamp: Date.now(),
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
        detectedAt: Date.now(),
        environment: this.getEnvironment(),
      },
      status: IssueStatus.RESOLVED,
      resolvedAt: Date.now(),
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
    return LogEntry.find({ blockId: new Types.ObjectId(blockId) })
      .sort({ timestamp: -1 })
      .limit(limit)
      .exec();
  }

  /**
   * Find all logs for a specific entry
   */
  async findByEntryId(entryId: string, limit: number = 50): Promise<ILogEntry[]> {
    return LogEntry.find({ entryIds: new Types.ObjectId(entryId) })
      .sort({ timestamp: -1 })
      .limit(limit)
      .exec();
  }

  /**
   * Find all open issues, optionally filtered by category
   */
  async findOpenIssues(category?: LogCategory): Promise<ILogEntry[]> {
    const filter: any = { status: IssueStatus.OPEN };
    if (category) {
      filter.category = category;
    }
    
    return LogEntry.find(filter)
      .sort({ timestamp: -1 })
      .exec();
  }

  /**
   * Find logs within date range
   */
  async findRecent(days: number, filter?: LogFilter): Promise<ILogEntry[]> {
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    
    const query: any = {
      timestamp: { $gte: since },
    };

    if (filter?.category) query.category = filter.category;
    if (filter?.level) query.level = filter.level;
    if (filter?.status) query.status = filter.status;
    if (filter?.blockId) query.blockId = new Types.ObjectId(filter.blockId);
    if (filter?.detectedBy) query['context.detectedBy'] = filter.detectedBy;
    if (filter?.fingerprint) query.fingerprint = filter.fingerprint;
    if (filter?.errorId) query['details.errorId'] = filter.errorId;
    if (filter?.requestId) {
      query.$or = [
        { 'context.requestId': filter.requestId },
        { 'details.requestId': filter.requestId },
      ];
    }
    if (filter?.path) query['details.path'] = filter.path;
    if (filter?.method) query['details.method'] = filter.method;
    if (filter?.errorName) query['details.errorName'] = filter.errorName;

    return LogEntry.find(query)
      .sort({ timestamp: filter?.sortOrder === 'asc' ? 1 : -1 })
      .exec();
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
    entry.statusHistory.push(historyEntry);

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
    entry.statusHistory.push(historyEntry);
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
   * Write log entry to JSON Lines file
   */
  private async writeToFile(entry: ILogEntry, subdir: 'issues' | 'actions' | 'metrics'): Promise<void> {
    try {
      const date = new Date().toISOString().split('T')[0];
      const dir = subdir === 'issues' ? getIssuesDir() : subdir === 'actions' ? getActionsDir() : getMetricsDir();
      const filePath = join(dir, `${date}.jsonl`);

      // Ensure directory exists
      await mkdir(dir, { recursive: true });

      // Prepare entry for file (convert ObjectIds to strings)
      const fileEntry = this.serializeForFile(entry);

      // Append to file
      const line = JSON.stringify(fileEntry) + '\n';
      await appendFile(filePath, line, 'utf-8');

      // Update entry with file location
      entry.fileLocation = {
        date,
        filePath,
      };
      await entry.save();
    } catch (error) {
      // File write failure should not break the main flow
      console.error('Failed to write log to file:', error);
    }
  }

  /**
   * Serialize log entry for file storage
   * Converts ObjectIds to strings for readability
   */
  private serializeForFile(entry: ILogEntry): any {
    const obj = entry.toObject();
    
    return {
      ...obj,
      _id: obj._id.toString(),
      blockId: obj.blockId?.toString(),
      resourceIds: obj.resourceIds?.map((id: any) => id.toString()),
      entryIds: obj.entryIds?.map((id: any) => id.toString()),
      actualState: obj.actualState ? {
        ...obj.actualState,
        duplicateBlocks: obj.actualState.duplicateBlocks?.map((id: any) => id.toString()),
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
    const nodeEnv = process.env.NODE_ENV;
    if (nodeEnv === 'production') return 'production';
    if (nodeEnv === 'test') return 'test';
    return 'development';
  }

  /**
   * Find and resolve open issues by blockId and category
   * Used by cleanup script to auto-close resolved issues
   * Performance optimized: bulk update
   */
  async resolveIssuesByBlockId(
    blockId: string,
    category: LogCategory,
    resolution: string,
    resolvedBy: string = 'cleanup-script'
  ): Promise<{ resolved: number; errors: string[] }> {
    const errors: string[] = [];

    try {
      // Find all open issues matching the criteria
      const openIssues = await LogEntry.find({
        blockId: new Types.ObjectId(blockId),
        category: category,
        status: IssueStatus.OPEN,
      });

      if (openIssues.length === 0) {
        return { resolved: 0, errors: [] };
      }

      const now = Date.now();

      // Bulk update all matching issues
      for (const issue of openIssues) {
        // Add to status history
        issue.statusHistory = issue.statusHistory || [];
        issue.statusHistory.push({
          status: issue.status,
          changedAt: now,
          changedBy: resolvedBy,
          note: 'Auto-resolved by cleanup action',
        });

        // Update status
        issue.status = IssueStatus.RESOLVED;
        issue.resolvedAt = now;
        issue.resolution = resolution;
        issue.resolvedBy = resolvedBy;

        await issue.save();
      }

      return { resolved: openIssues.length, errors };
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

            const fileDate = new Date(`${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`).getTime();
            
            // Check if file is older than threshold
            if (fileDate < archiveThreshold) {
              const sourcePath = join(dir, file);
              const monthDir = join(getArchiveDir(), dateMatch[1], dateMatch[2]);
              
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
