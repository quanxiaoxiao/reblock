import { Types } from 'mongoose';
import { appendFile, mkdir } from 'fs/promises';
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
const LOG_DIR = join(process.cwd(), env.STORAGE_LOG_DIR);
const ISSUES_DIR = join(LOG_DIR, 'issues');
const ACTIONS_DIR = join(LOG_DIR, 'actions');
const ARCHIVE_DIR = join(LOG_DIR, 'archive');

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

// Interface for log filter
export interface LogFilter {
  category?: LogCategory;
  level?: LogLevel;
  status?: IssueStatus;
  blockId?: string;
  detectedBy?: string;
  startDate?: Date;
  endDate?: Date;
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
    // Build the log entry
    const entry = new LogEntry({
      timestamp: Date.now(),
      level: params.level,
      category: params.category,
      blockId: params.blockId ? new Types.ObjectId(params.blockId) : undefined,
      resourceIds: params.resourceIds?.map(id => new Types.ObjectId(id)),
      entryIds: params.entryIds?.map(id => new Types.ObjectId(id)),
      details: params.details,
      suggestedAction: params.suggestedAction,
      recoverable: params.recoverable,
      dataLossRisk: params.dataLossRisk || DataLossRisk.NONE,
      recoverySteps: params.recoverySteps,
      context: {
        detectedBy: params.context?.detectedBy || 'system',
        detectedAt: Date.now(),
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

    return LogEntry.find(query)
      .sort({ timestamp: -1 })
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
  private async writeToFile(entry: ILogEntry, subdir: 'issues' | 'actions'): Promise<void> {
    try {
      const date = new Date().toISOString().split('T')[0];
      const dir = subdir === 'issues' ? ISSUES_DIR : ACTIONS_DIR;
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
   * Archive old log files (move files older than LOG_ARCHIVE_DAYS to archive/)
   * Should be called periodically (e.g., daily via cron)
   */
  async archiveOldFiles(): Promise<{ archived: number; errors: string[] }> {
    const archiveThreshold = Date.now() - LOG_ARCHIVE_MS;
    const errors: string[] = [];
    const archived = 0;

    try {
      // Ensure archive directory exists
      await mkdir(ARCHIVE_DIR, { recursive: true });

      // This is a placeholder - in real implementation, you would:
      // 1. List all files in ISSUES_DIR and ACTIONS_DIR
      // 2. Parse dates from filenames
      // 3. Use archiveThreshold to filter files older than LOG_ARCHIVE_DAYS
      // 4. Move files to ARCHIVE_DIR organized by month (e.g., archive/2024-02/)

      console.log(`Archived ${archived} log files (threshold: ${archiveThreshold})`);
    } catch (error) {
      errors.push(`Failed to archive files: ${error}`);
    }

    return { archived, errors };
  }
}

// Export singleton instance
export const logService = new LogService();
