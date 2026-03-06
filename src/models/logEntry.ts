import mongoose, { Schema } from 'mongoose';
import type { Document, Types } from 'mongoose';
import { env } from '../config/env';

/**
 * LogEntry Model
 * 
 * Comprehensive logging system for tracking anomalies in the Reblock system.
 * Stores both in MongoDB (for querying) and JSON Lines files (for AI analysis).
 * 
 * Features:
 * - LOG_TTL_DAYS TTL automatic cleanup
 * - Dual storage: MongoDB + File system
 * - Comprehensive context tracking
 * - Recovery support
 */

// Log severity levels
export enum LogLevel {
  CRITICAL = 'CRITICAL',
  ERROR = 'ERROR',
  WARNING = 'WARNING',
  INFO = 'INFO',
}

// Log categories for different types of issues
export enum LogCategory {
  ORPHANED_BLOCK = 'ORPHANED_BLOCK',
  MISSING_FILE = 'MISSING_FILE',
  DUPLICATE_SHA256 = 'DUPLICATE_SHA256',
  LINKCOUNT_MISMATCH = 'LINKCOUNT_MISMATCH',
  FILE_SIZE_MISMATCH = 'FILE_SIZE_MISMATCH',
  CLEANUP_ACTION = 'CLEANUP_ACTION',
  CLEANUP_ERROR = 'CLEANUP_ERROR',
  RUNTIME_ERROR = 'RUNTIME_ERROR',
  DATA_INCONSISTENCY = 'DATA_INCONSISTENCY',
  METRICS_SNAPSHOT = 'METRICS_SNAPSHOT',
}

// Issue status tracking
export enum IssueStatus {
  OPEN = 'open',
  ACKNOWLEDGED = 'acknowledged',
  RESOLVED = 'resolved',
  IGNORED = 'ignored',
}

// Data loss risk assessment
export enum DataLossRisk {
  NONE = 'none',
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

// Context information about detection
export interface ILogContext {
  detectedBy: 'doctor' | 'cleanup' | 'resourceService' | 'uploadService' | 'migrationService' | 'system';
  detectedAt: number;
  scriptVersion?: string | undefined;
  serverVersion?: string | undefined;
  environment: 'development' | 'production' | 'test';
  originalCreatedAt?: number | undefined;
  daysSinceCreation?: number | undefined;
  lastAccessedAt?: number | undefined;
  stackTrace?: string | undefined;
  requestId?: string | undefined;
  userAgent?: string | undefined;
}

// Status history entry
export interface IStatusHistoryEntry {
  status: string;
  changedAt: number;
  changedBy?: string | undefined;
  note?: string | undefined;
}

// File storage location info
export interface IFileLocation {
  date: string;
  filePath: string;
  lineNumber?: number | undefined;
}

// Block snapshot at detection time
export interface IBlockSnapshot {
  size: number;
  linkCount: number;
  createdAt: number;
  updatedAt: number;
  isInvalid: boolean;
}

// Actual state when detected
export interface IActualState {
  refCount: number;
  fileExists: boolean;
  fileSize?: number | undefined;
  duplicateBlocks?: Types.ObjectId[] | undefined;
}

// Main LogEntry interface
export interface ILogEntry extends Document {
  // Basic info
  timestamp: number;
  level: LogLevel;
  category: LogCategory;
  
  // Related data
  blockId?: Types.ObjectId | undefined;
  blockSha256?: string | undefined;
  resourceIds?: Types.ObjectId[] | undefined;
  entryIds?: Types.ObjectId[] | undefined;
  
  // Block snapshot
  blockSnapshot?: IBlockSnapshot | undefined;
  
  // Dynamic details based on category
  details: Record<string, unknown>;
  fingerprint?: string | undefined;
  occurrenceCount?: number | undefined;
  firstSeenAt?: number | undefined;
  lastSeenAt?: number | undefined;
  
  // Actual state at detection
  actualState?: IActualState | undefined;
  
  // Context
  context: ILogContext;
  
  // Recommendations
  suggestedAction: string;
  recoverable: boolean;
  dataLossRisk: DataLossRisk;
  recoverySteps?: string[] | undefined;
  
  // Status tracking
  status: IssueStatus;
  statusHistory?: IStatusHistoryEntry[] | undefined;
  resolvedAt?: number | undefined;
  resolution?: string | undefined;
  resolvedBy?: string | undefined;
  
  // File storage location
  fileLocation?: IFileLocation | undefined;
  
  // Metadata
  createdAt: number;
  expiresAt?: Date | undefined;
}

// Schema definition
const statusHistorySchema = new Schema<IStatusHistoryEntry>({
  status: { type: String, required: true },
  changedAt: { type: Number, required: true },
  changedBy: { type: String },
  note: { type: String },
}, { _id: false });

const logEntrySchema = new Schema<ILogEntry>({
  // Basic information
  timestamp: { 
    type: Number, 
    required: true, 
    default: (): number => Date.now(),
  },
  level: { 
    type: String, 
    enum: Object.values(LogLevel), 
    required: true 
  },
  category: { 
    type: String, 
    enum: Object.values(LogCategory), 
    required: true,
    index: true 
  },
  
  // Related entities
  blockId: { 
    type: Schema.Types.ObjectId, 
    ref: 'Block',
    index: true 
  },
  blockSha256: { 
    type: String,
    index: true 
  },
  resourceIds: [{ 
    type: Schema.Types.ObjectId, 
    ref: 'Resource' 
  }],
  entryIds: [{ 
    type: Schema.Types.ObjectId, 
    ref: 'Entry' 
  }],
  
  // Block state snapshot
  blockSnapshot: {
    size: Number,
    linkCount: Number,
    createdAt: Number,
    updatedAt: Number,
    isInvalid: Boolean,
  },
  
  // Issue details
  details: { 
    type: Schema.Types.Mixed, 
    default: {} 
  },
  fingerprint: {
    type: String,
    index: true,
  },
  occurrenceCount: {
    type: Number,
    default: 1,
  },
  firstSeenAt: Number,
  lastSeenAt: Number,
  
  // Actual detected state
  actualState: {
    refCount: Number,
    fileExists: Boolean,
    fileSize: Number,
    duplicateBlocks: [{ type: Schema.Types.ObjectId, ref: 'Block' }],
  },
  
  // Detection context
  context: {
    detectedBy: {
      type: String,
      required: true,
      enum: ['doctor', 'cleanup', 'resourceService', 'uploadService', 'migrationService', 'system']
    },
    detectedAt: { type: Number, required: true },
    scriptVersion: String,
    serverVersion: String,
    environment: { 
      type: String, 
      enum: ['development', 'production', 'test'],
      required: true 
    },
    originalCreatedAt: Number,
    daysSinceCreation: Number,
    lastAccessedAt: Number,
    stackTrace: String,
    requestId: String,
    userAgent: String,
  },
  
  // Action recommendations
  suggestedAction: { 
    type: String, 
    required: true 
  },
  recoverable: { 
    type: Boolean, 
    required: true 
  },
  dataLossRisk: { 
    type: String, 
    enum: Object.values(DataLossRisk),
    default: DataLossRisk.NONE 
  },
  recoverySteps: [String],
  
  // Status tracking
  status: { 
    type: String, 
    enum: Object.values(IssueStatus),
    default: IssueStatus.OPEN,
    index: true 
  },
  statusHistory: [statusHistorySchema],
  resolvedAt: Number,
  resolution: String,
  resolvedBy: String,
  
  // File storage reference
  fileLocation: {
    date: String,
    filePath: String,
    lineNumber: Number,
  },
  
  // TTL expiration - must be Date type for MongoDB TTL index to work
  expiresAt: { 
    type: Date,
    default: (): Date => new Date(Date.now() + env.LOG_TTL_DAYS * 24 * 60 * 60 * 1000),
  },
  
  // Explicit timestamp field (number ms), not mongoose timestamps
  createdAt: {
    type: Number,
    default: (): number => Date.now(),
  },
});

// Index configuration for query optimization
logEntrySchema.index({ category: 1, status: 1, timestamp: -1 });
logEntrySchema.index({ blockId: 1, timestamp: -1 });
logEntrySchema.index({ 'context.detectedBy': 1, timestamp: -1 });
logEntrySchema.index({ 'context.requestId': 1, timestamp: -1 });
logEntrySchema.index({ level: 1, timestamp: -1 });
logEntrySchema.index({ status: 1, timestamp: -1 });
logEntrySchema.index({ category: 1, fingerprint: 1, status: 1, timestamp: -1 });
logEntrySchema.index({ category: 1, 'details.errorId': 1, timestamp: -1 });
logEntrySchema.index({ category: 1, 'details.path': 1, 'details.method': 1, timestamp: -1 });
logEntrySchema.index({ category: 1, 'details.errorName': 1, timestamp: -1 });
logEntrySchema.index({ category: 1, 'details.requestId': 1, timestamp: -1 });

// TTL index - automatically delete after LOG_TTL_DAYS
logEntrySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Index for querying logs by entry ID
logEntrySchema.index({ entryIds: 1, timestamp: -1 });

// Export model
export const LogEntry = mongoose.model<ILogEntry>('LogEntry', logEntrySchema);

// Limit statusHistory to prevent unbounded growth (keep last 100 entries)
export const MAX_STATUS_HISTORY = 100;
