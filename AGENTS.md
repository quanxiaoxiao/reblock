# Reblock Logging System Strategy

## Overview

This document outlines the comprehensive logging system implemented in Reblock for tracking anomalies and supporting AI-assisted analysis and data recovery.

## Architecture

### Dual Storage Strategy

```
┌─────────────────────────────────────────────────────────────┐
│                     Application Layer                        │
│  (Doctor, Cleanup, ResourceService, UploadService)          │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                        LogService                            │
│  ┌─────────────────────┐  ┌──────────────────────────────┐ │
│  │    MongoDB          │  │      File System             │ │
│  │  (Query & Analysis) │  │  (AI Model Reading)          │ │
│  │                     │  │                              │ │
│  │  - TTL: 90 days     │  │  - JSON Lines format         │ │
│  │  - Indexed fields   │  │  - Daily rotation            │ │
│  │  - Status tracking  │  │  - Archive after 30 days     │ │
│  └─────────────────────┘  └──────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Storage Locations

- **MongoDB**: Primary storage with TTL automatic cleanup (90 days)
- **Files**: `storage/_logs/issues/YYYY-MM-DD.jsonl` (for AI analysis)
- **Archive**: `storage/_logs/archive/` (30+ day old logs)

## Data Model

### LogEntry Schema

All fields are in English for consistency and AI compatibility.

#### Core Fields

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | number | Unix timestamp (milliseconds) when log created |
| `level` | enum | CRITICAL / ERROR / WARNING / INFO |
| `category` | enum | Type of issue (see categories below) |

#### Categories

- `ORPHANED_BLOCK`: Block with linkCount=0 and no resources referencing it
- `MISSING_FILE`: Physical file missing from storage
- `DUPLICATE_SHA256`: Multiple blocks with same SHA256 hash
- `LINKCOUNT_MISMATCH`: linkCount doesn't match actual resource count
- `FILE_SIZE_MISMATCH`: Physical file size differs from recorded size
- `CLEANUP_ACTION`: Record of cleanup operation performed
- `CLEANUP_ERROR`: Failed cleanup operation
- `RUNTIME_ERROR`: Error during runtime operation
- `DATA_INCONSISTENCY`: General data consistency issue

#### Entity References

| Field | Type | Description |
|-------|------|-------------|
| `blockId` | ObjectId | Associated Block ID |
| `blockSha256` | string | Block content hash (for quick lookup) |
| `resourceIds` | ObjectId[] | Affected Resource IDs |
| `entryIds` | ObjectId[] | Affected Entry IDs |

#### State Snapshots

```typescript
blockSnapshot: {
  size: number;           // Recorded file size
  linkCount: number;      // Recorded reference count
  createdAt: number;      // Block creation time
  updatedAt: number;      // Last update time
  isInvalid: boolean;     // Soft delete status
}

actualState: {
  refCount: number;       // Actual resource count
  fileExists: boolean;    // Physical file existence
  fileSize?: number;      // Actual file size
  duplicateBlocks?: ObjectId[];  // Other blocks with same SHA256
}
```

#### Context Information

```typescript
context: {
  detectedBy: 'doctor' | 'cleanup' | 'resourceService' | 'uploadService' | 'system';
  detectedAt: number;     // Detection timestamp
  scriptVersion?: string; // Version of detection script
  serverVersion?: string; // Application version
  environment: 'development' | 'production' | 'test';
  originalCreatedAt?: number;  // Block original creation time
  daysSinceCreation?: number;  // Age in days
  lastAccessedAt?: number;     // Last access time
  stackTrace?: string;    // Error stack trace if applicable
  requestId?: string;     // HTTP request ID for tracing
  userAgent?: string;     // Client user agent
}
```

#### Action Recommendations

| Field | Type | Description |
|-------|------|-------------|
| `suggestedAction` | string | Human-readable recommended action |
| `recoverable` | boolean | Whether the issue can be recovered |
| `dataLossRisk` | enum | none / low / medium / high |
| `recoverySteps` | string[] | Step-by-step recovery instructions |

#### Status Tracking

```typescript
status: 'open' | 'acknowledged' | 'resolved' | 'ignored';
statusHistory: [{
  status: string;
  changedAt: number;
  changedBy?: string;
  note?: string;
}];
resolvedAt?: number;
resolution?: string;
resolvedBy?: string;
```

#### File Storage Reference

```typescript
fileLocation: {
  date: string;           // YYYY-MM-DD
  filePath: string;       // Full path to JSONL file
  lineNumber?: number;    // Line number in file
}
```

## LogService API

### Core Methods

```typescript
// Log a detected issue
async logIssue(params: LogIssueParams): Promise<ILogEntry>;

// Log a cleanup action
async logCleanupAction(params: LogCleanupActionParams): Promise<ILogEntry>;

// Check for duplicate issues (prevents duplicate logging)
async checkDuplicate(category: LogCategory, blockId: string, sinceHours?: number): Promise<boolean>;

// Query methods
async findByBlockId(blockId: string, limit?: number): Promise<ILogEntry[]>;
async findOpenIssues(category?: LogCategory, limit?: number): Promise<ILogEntry[]>; // default 200, max 1000
async findRecent(days: number, filter?: LogFilter): Promise<ILogEntry[]>;

// Status management
async markResolved(logId: string, resolution: string, resolvedBy?: string): Promise<void>;
async markAcknowledged(logId: string, note?: string): Promise<void>;

// Reporting
async generateSummary(): Promise<LogSummary>;
```

## JSON Lines Format

Each line is a complete JSON object (no trailing commas, one per line):

```json
{"timestamp":1772241136645,"level":"INFO","category":"ORPHANED_BLOCK","blockId":"69a23a307ffd3487af73c550","blockSha256":"5fcfb00479ff7c372cb2...","resourceIds":[],"entryIds":[],"details":{"reason":"linkCount=0 but not soft deleted","sha256":"5fcfb...","size":35},"actualState":{"refCount":0,"fileExists":true},"context":{"detectedBy":"doctor","detectedAt":1772241136645,"scriptVersion":"1.0.0","environment":"development","originalCreatedAt":1772239408335,"daysSinceCreation":0},"suggestedAction":"Soft delete this block using cleanup tool","recoverable":true,"dataLossRisk":"none","recoverySteps":["Run cleanup to soft delete orphaned blocks"],"status":"open","_id":"69a240f06df3ccf956fe19a8","createdAt":"2026-02-28T01:12:16.650Z","expiresAt":"2026-05-29T01:12:16.649Z"}
```

### Benefits for AI Analysis

1. **Line-by-line parsing**: Each line is self-contained, easy to stream process
2. **Complete context**: All relevant information in single record
3. **Consistent schema**: Same fields across all log types
4. **Queryable**: Can use `jq`, `grep`, or load into pandas/DataFrame
5. **Human readable**: Timestamps, enums, and IDs in plain text

## Integration Points

### Doctor Script

Automatically logs all detected issues:
- Checks for duplicates within 24 hours
- Maps internal issue types to LogCategory
- Sets appropriate severity levels
- Includes full context (script version, environment, etc.)

### Cleanup Script

Logs:
- Actions performed (soft delete, linkCount fix)
- Before/after state snapshots
- Success/failure status
- Resolution notes for original issues

### Runtime Services

ResourceService and UploadService log:
- Data inconsistency errors
- File access errors
- Download failures with request context

### Resource Block Change History

To keep `resource._id` stable while updating the underlying block binding:

- Use transactional block switching (`resource -> new block`) in service layer
- Update both blocks' `linkCount` atomically in same transaction
- Insert immutable `resource_history` record for each switch/rollback
- Query history via `GET /resources/:id/history`
- Rollback via `POST /resources/:id/rollback`

## Indexing Strategy

MongoDB indexes for optimal query performance:

```javascript
// Compound indexes for common queries
{ category: 1, status: 1, timestamp: -1 }     // Query by category and status
{ blockId: 1, timestamp: -1 }                  // Query block history
{ 'context.detectedBy': 1, timestamp: -1 }     // Query by source
{ level: 1, timestamp: -1 }                    // Query by severity
{ status: 1, timestamp: -1 }                   // Query open issues

// TTL index for automatic cleanup
{ expiresAt: 1 }, { expireAfterSeconds: 0 }   // 90 day TTL
```

## Recovery Support

Each log entry includes:

1. **Complete state snapshot**: Can reconstruct block state at detection time
2. **Recovery steps**: Human-readable instructions for fixing
3. **Risk assessment**: Data loss risk level (none/low/medium/high)
4. **Recoverable flag**: Whether automated recovery is possible
5. **Status tracking**: Track issue lifecycle (open → acknowledged → resolved)

## Usage Examples

### Query Recent Critical Issues

```javascript
const criticalIssues = await logService.findRecent(7, {
  level: LogLevel.CRITICAL,
  status: IssueStatus.OPEN
});
```

### Check Block History

```javascript
const history = await logService.findByBlockId('69a23a307ffd3487af73c550');
```

### Mark Issue Resolved

```javascript
await logService.markResolved(
  logId,
  'Soft deleted via cleanup script',
  'cleanup-script'
);
```

## File Analysis Examples

### Using jq (command line)

```bash
# Count issues by category
cat 2026-02-28.jsonl | jq -r '.category' | sort | uniq -c

# Find all CRITICAL issues
cat 2026-02-28.jsonl | jq 'select(.level == "CRITICAL")'

# Get block IDs with missing files
cat 2026-02-28.jsonl | jq -r 'select(.category == "MISSING_FILE") | .blockId'

# Calculate total size of orphaned blocks
cat 2026-02-28.jsonl | jq -s '[.[] | select(.category == "ORPHANED_BLOCK") | .details.size] | add'
```

### Using Python/Pandas

```python
import pandas as pd
import json

# Load logs
df = pd.read_json('storage/_logs/issues/2026-02-28.jsonl', lines=True)

# Summary by category
print(df['category'].value_counts())

# Filter critical issues
critical = df[df['level'] == 'CRITICAL']

# Time series of issues
df['datetime'] = pd.to_datetime(df['timestamp'], unit='ms')
df.groupby([df['datetime'].dt.date, 'category']).size().unstack().plot()
```

## Implementation Status

- [x] P0: Core model and service
- [x] P0: Doctor integration
- [x] P1: Cleanup integration
- [x] P1: Log analysis tools
- [x] P2: Runtime service integration (ResourceService, UploadService)
- [x] P2: Resource block history & rollback
- [x] P2: Archive automation
- [ ] P2: Log restore scripts

## Configuration

Environment variables:

```bash
# In .env file
CLEANUP_DEFAULT_DAYS=30          # Default cleanup threshold
CLEANUP_BACKUP_REMINDER=true     # Show backup reminder
```

## Best Practices

1. **Always check for duplicates** before logging to avoid spam
2. **Include full context** (script version, environment, timestamps)
3. **Set appropriate risk levels** for data loss assessment
4. **Provide clear recovery steps** for each issue type
5. **Update status** when issues are resolved
6. **Archive old logs** periodically to manage storage

## Future Enhancements

1. **Webhook notifications** for CRITICAL issues
2. **Dashboard** for visual log analysis
3. **Automated recovery** scripts based on log entries
4. **Log correlation** with application metrics
5. **Export to external systems** (ELK, Datadog, etc.)
