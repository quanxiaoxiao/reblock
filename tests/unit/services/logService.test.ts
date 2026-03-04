import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LogService, logService } from '../../../src/services/logService';

// Mock fs/promises
vi.mock('fs/promises', () => ({
  appendFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  rename: vi.fn().mockResolvedValue(undefined),
}));

// Mock config
vi.mock('../../../src/config/env', () => ({
  env: {
    STORAGE_LOG_DIR: './storage/_logs',
    LOG_ARCHIVE_DAYS: 30,
    LOG_DEDUP_WINDOW_MINUTES: 10,
    NODE_ENV: 'test',
  },
}));

// Mock LogEntry model
const mockSave = vi.fn().mockResolvedValue({ _id: 'log-id-123' });
const mockToObject = vi.fn().mockReturnValue({ _id: 'log-id-123' });

vi.mock('../../../src/models/logEntry', () => {
  const LogEntry = vi.fn().mockImplementation(function(this: any, data: any) {
    Object.assign(this, data);
    this.save = mockSave;
    this.toObject = mockToObject;
    return this;
  });
  
  LogEntry.find = vi.fn();
  LogEntry.findOne = vi.fn();
  LogEntry.findById = vi.fn();
  LogEntry.findOneAndUpdate = vi.fn();
  LogEntry.countDocuments = vi.fn();
  LogEntry.aggregate = vi.fn();
  
  return {
    LogEntry,
    LogLevel: {
      CRITICAL: 'CRITICAL',
      ERROR: 'ERROR',
      WARNING: 'WARNING',
      INFO: 'INFO',
    },
    LogCategory: {
      ORPHANED_BLOCK: 'ORPHANED_BLOCK',
      MISSING_FILE: 'MISSING_FILE',
      DUPLICATE_SHA256: 'DUPLICATE_SHA256',
      LINKCOUNT_MISMATCH: 'LINKCOUNT_MISMATCH',
      FILE_SIZE_MISMATCH: 'FILE_SIZE_MISMATCH',
      CLEANUP_ACTION: 'CLEANUP_ACTION',
      CLEANUP_ERROR: 'CLEANUP_ERROR',
      RUNTIME_ERROR: 'RUNTIME_ERROR',
      DATA_INCONSISTENCY: 'DATA_INCONSISTENCY',
      METRICS_SNAPSHOT: 'METRICS_SNAPSHOT',
    },
    IssueStatus: {
      OPEN: 'open',
      ACKNOWLEDGED: 'acknowledged',
      RESOLVED: 'resolved',
      IGNORED: 'ignored',
    },
    DataLossRisk: {
      NONE: 'none',
      LOW: 'low',
      MEDIUM: 'medium',
      HIGH: 'high',
    },
  };
});

describe('LogService', () => {
  let service: LogService;

  beforeEach(() => {
    service = new LogService();
    vi.clearAllMocks();
  });

  describe('basic functionality', () => {
    it('should instantiate correctly', async () => {
      expect(service).toBeInstanceOf(LogService);
    });
  });
});

describe('logService singleton', () => {
  it('should be an instance of LogService', () => {
    expect(logService).toBeInstanceOf(LogService);
  });
});
