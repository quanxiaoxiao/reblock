# Data Model Rule

This document defines the complete data model for all entities in the Reblock service.

---

## Overview

All entities follow these rules:

1. **Timestamps**: Unix milliseconds (`Date.now()`)
2. **Soft Delete**: `isInvalid` flag + `invalidatedAt` timestamp
3. **ID Type**: MongoDB `ObjectId` (stored as string in API)
4. **No Physical Delete**: All delete operations set `isInvalid: true`

---

## Block Model

### JSON Example

```json
{
  "_id": "60d21b4667d0d8992e610c85",
  "sha256": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0",
  "linkCount": 3,
  "size": 1024000,
  "createdAt": 1772241136645,
  "updatedAt": 1772242000000,
  "isInvalid": false
}
```

### Fields

| Field         | Type      | Required | Default   | Description                           |
|---------------|-----------|----------|-----------|---------------------------------------|
| `_id`         | ObjectId  | ✅ Auto   | -         | Unique identifier                     |
| `sha256`      | string    | ✅ Yes    | -         | SHA256 hash of file content           |
| `linkCount`   | number    | ✅ Yes    | 1         | Number of resources referencing this block |
| `size`        | number    | -        | -         | File size in bytes                    |
| `createdAt`   | number    | ✅ Auto   | Date.now() | Unix timestamp (ms)                  |
| `updatedAt`   | number    | ✅ Auto   | Date.now() | Unix timestamp (ms)                  |
| `isInvalid`   | boolean   | ✅ Auto   | false     | Soft delete flag                      |
| `invalidatedAt`| number   | -        | -         | Unix timestamp when soft deleted     |

### Indexes

```javascript
// Partial unique index - only for valid blocks
{ sha256: 1 }, { unique: true, partialFilterExpression: { isInvalid: false } }

// Indexes for queries
{ isInvalid: 1 }
{ invalidatedAt: 1 }
```

### Constraints

- `sha256` must be unique among non-deleted blocks (via partial unique index)
- `linkCount` >= 0 (should never go negative)
- When `linkCount` = 0 and `isInvalid` = false, block is "orphaned"

### Relationships

- Referenced by: `Resource.block` (many-to-one)
- One block can be referenced by multiple resources

---

## Entry Model

### Interface

```typescript
interface IEntry {
  _id: Types.ObjectId;
  name: string;
  alias: string;
  isDefault: boolean;
  order?: number;
  description: string;
  uploadConfig?: IUploadConfig;
  createdAt: number;
  updatedAt: number;
  isInvalid: boolean;
  invalidatedAt?: number;
}

interface IUploadConfig {
  maxFileSize?: number;
  allowedMimeTypes?: string[];
  readOnly?: boolean;
}
```

### Fields

| Field          | Type       | Required | Default    | Description                           |
|----------------|------------|----------|------------|---------------------------------------|
| `_id`          | ObjectId   | ✅ Auto   | -          | Unique identifier                     |
| `name`         | string     | ✅ Yes    | -          | Display name (trimmed)                |
| `alias`        | string     | -        | ''         | URL-friendly identifier (trimmed)     |
| `isDefault`    | boolean    | -        | false      | Only one default entry allowed        |
| `order`        | number     | -        | -          | Display order                         |
| `description`  | string     | -        | ''         | Description text                      |
| `uploadConfig` | object     | -        | -          | Upload restrictions                   |
| `createdAt`    | number     | ✅ Auto   | Date.now() | Unix timestamp (ms)                   |
| `updatedAt`    | number     | ✅ Auto   | Date.now() | Unix timestamp (ms)                   |
| `isInvalid`    | boolean    | ✅ Auto   | false      | Soft delete flag                      |
| `invalidatedAt` | number    | -        | -          | Unix timestamp when soft deleted     |

### Upload Config Fields

| Field              | Type          | Description                           |
|--------------------|---------------|---------------------------------------|
| `maxFileSize`      | number        | Max file size in bytes (e.g., 10485760 = 10MB) |
| `allowedMimeTypes` | string[]      | Allowed MIME types (e.g., `["image/*", "video/mp4"]`) |
| `readOnly`         | boolean       | If true, rejects uploads (403)       |

### Indexes

```javascript
// Partial unique index - only for default entries
{ isDefault: 1 }, { unique: true, partialFilterExpression: { isDefault: true, isInvalid: false } }

// Index for alias lookup
{ alias: 1 }

// Indexes for queries
{ isInvalid: 1 }
{ invalidatedAt: 1 }
```

### Constraints

- Only ONE entry can have `isDefault: true` at a time (enforced by partial unique index)
- `alias` must be unique among non-deleted entries
- `name` is required and trimmed

### Relationships

- References: `Resource.entry` (one-to-many)
- Default entry: Can be used for uploads without specifying alias

---

## Resource Model

### Interface

```typescript
interface IResource {
  _id: Types.ObjectId;
  block: Types.ObjectId | IBlock;
  entry: Types.ObjectId | IEntry;
  mime?: string;
  category?: string;
  description: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  lastAccessedAt: number;
  isInvalid: boolean;
  invalidatedAt?: number;
}
```

### Fields

| Field            | Type       | Required | Default    | Description                           |
|------------------|------------|----------|------------|---------------------------------------|
| `_id`            | ObjectId  | ✅ Auto   | -          | Unique identifier                     |
| `block`          | ObjectId  | ✅ Yes    | -          | Reference to Block                    |
| `entry`          | ObjectId  | ✅ Yes    | -          | Reference to Entry                    |
| `name`           | string     | -        | ''         | Display name (trimmed)                |
| `mime`           | string     | -        | -          | MIME type (e.g., "image/png")        |
| `category`       | string     | -        | -          | Category for grouping                 |
| `description`    | string     | -        | ''         | Description text                      |
| `createdAt`      | number     | ✅ Auto   | Date.now() | Unix timestamp (ms)                   |
| `updatedAt`      | number     | ✅ Auto   | Date.now() | Unix timestamp (ms)                   |
| `lastAccessedAt` | number     | ✅ Auto   | Date.now() | Last download/access time             |
| `isInvalid`      | boolean    | ✅ Auto   | false      | Soft delete flag                      |
| `invalidatedAt`  | number     | -        | -          | Unix timestamp when soft deleted     |

### Indexes

```javascript
// Index for block lookup
{ block: 1 }

// Indexes for filtering
{ entry: 1 }
{ mime: 1 }
{ category: 1 }
{ isInvalid: 1 }
{ invalidatedAt: 1 }

// Index for sorting/access tracking
{ lastAccessedAt: 1 }
```

### Constraints

- `block` is required and must reference a valid Block
- `entry` is required and must reference a valid Entry
- When deleting, must decrement linked Block's `linkCount`

### Relationships

- References: `Block.block` (many-to-one)
- References: `Entry.entry` (many-to-one)
- Populated fields: `block.sha256`, `entry.name`, `entry.alias`

---

## LogEntry Model

### Interface

```typescript
interface ILogEntry {
  _id: Types.ObjectId;
  timestamp: number;
  level: LogLevel;
  category: LogCategory;
  blockId?: Types.ObjectId;
  blockSha256?: string;
  resourceIds?: Types.ObjectId[];
  entryIds?: Types.ObjectId[];
  details?: Record<string, unknown>;
  actualState?: {
    refCount?: number;
    fileExists?: boolean;
    fileSize?: number;
    duplicateBlocks?: Types.ObjectId[];
  };
  context: {
    detectedBy: 'doctor' | 'cleanup' | 'resourceService' | 'uploadService' | 'system';
    detectedAt: number;
    scriptVersion?: string;
    serverVersion?: string;
    environment: 'development' | 'production' | 'test';
    originalCreatedAt?: number;
    daysSinceCreation?: number;
    lastAccessedAt?: number;
    stackTrace?: string;
    requestId?: string;
    userAgent?: string;
  };
  suggestedAction?: string;
  recoverable?: boolean;
  dataLossRisk?: DataLossRisk;
  recoverySteps?: string[];
  status: 'open' | 'acknowledged' | 'resolved' | 'ignored';
  statusHistory?: {
    status: string;
    changedAt: number;
    changedBy?: string;
    note?: string;
  }[];
  resolvedAt?: number;
  resolution?: string;
  resolvedBy?: string;
  createdAt: number;
  expiresAt: number;  // TTL: 90 days
}
```

### Enums

```typescript
enum LogLevel {
  CRITICAL = 'CRITICAL',
  ERROR = 'ERROR',
  WARNING = 'WARNING',
  INFO = 'INFO'
}

enum LogCategory {
  ORPHANED_BLOCK = 'ORPHANED_BLOCK',
  MISSING_FILE = 'MISSING_FILE',
  DUPLICATE_SHA256 = 'DUPLICATE_SHA256',
  LINKCOUNT_MISMATCH = 'LINKCOUNT_MISMATCH',
  FILE_SIZE_MISMATCH = 'FILE_SIZE_MISMATCH',
  CLEANUP_ACTION = 'CLEANUP_ACTION',
  CLEANUP_ERROR = 'CLEANUP_ERROR',
  RUNTIME_ERROR = 'RUNTIME_ERROR',
  DATA_INCONSISTENCY = 'DATA_INCONSISTENCY'
}

enum DataLossRisk {
  NONE = 'none',
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high'
}
```

### Fields

| Field            | Type        | Required | Description                           |
|------------------|-------------|----------|---------------------------------------|
| `_id`            | ObjectId    | ✅ Auto  | Unique identifier                     |
| `timestamp`      | number      | ✅ Auto  | Unix timestamp when log created      |
| `level`          | LogLevel    | ✅ Yes   | Severity level                        |
| `category`       | LogCategory | ✅ Yes   | Type of issue                         |
| `blockId`        | ObjectId    | -        | Associated Block ID                   |
| `blockSha256`    | string      | -        | Block content hash                    |
| `resourceIds`    | ObjectId[]  | -        | Affected Resource IDs                |
| `entryIds`       | ObjectId[]  | -        | Affected Entry IDs                    |
| `details`        | object      | -        | Additional issue details              |
| `actualState`    | object      | -        | Actual state at detection time        |
| `context`        | object      | ✅ Yes   | Detection context                     |
| `suggestedAction`| string      | -        | Recommended action                    |
| `recoverable`    | boolean     | -        | Whether issue can be recovered        |
| `dataLossRisk`   | DataLossRisk| -        | Data loss risk level                  |
| `recoverySteps`  | string[]   | -        | Recovery instructions                 |
| `status`         | string      | ✅ Yes   | Issue status                          |
| `statusHistory`  | object[]    | -        | Status change history                 |
| `resolvedAt`     | number      | -        | Resolution timestamp                   |
| `resolution`     | string      | -        | Resolution description                 |
| `resolvedBy`     | string      | -        | Who resolved the issue                |
| `createdAt`      | number      | ✅ Auto  | Creation timestamp                    |
| `expiresAt`      | number      | ✅ Auto  | TTL expiration (90 days)              |

### Indexes

```javascript
// Compound indexes for common queries
{ category: 1, status: 1, timestamp: -1 }
{ blockId: 1, timestamp: -1 }
{ 'context.detectedBy': 1, timestamp: -1 }
{ level: 1, timestamp: -1 }
{ status: 1, timestamp: -1 }

// TTL index - automatic cleanup after 90 days
{ expiresAt: 1 }, { expireAfterSeconds: 0 }
```

---

## Model Relationships Diagram

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│   Entry     │       │  Resource   │       │    Block    │
├─────────────┤       ├─────────────┤       ├─────────────┤
│ _id         │◄──────│ entry       │       │ _id         │
│ name        │       │ _id         │◄──────│ block       │
│ alias       │       │ block       │       │ sha256      │
│ isDefault   │       │ name        │       │ linkCount   │
│ order       │       │ mime        │       │ size        │
│ description │       │ category    │       │ isInvalid   │
│ uploadConfig│       │ description │       └─────────────┘
│ isInvalid   │       │ isInvalid   │
└─────────────┘       └─────────────┘
       │                     │
       │                     │
       └─────────────────────┘
              (many-to-many via linkCount)
```

---

## Query Patterns

### Find All Valid Blocks

```typescript
Block.find({ isInvalid: { $ne: true } })
```

### Find Resource with Populated Block

```typescript
Resource.findOne({ _id: id, isInvalid: { $ne: true } })
  .populate('block', 'sha256')
```

### Find Resources by Entry

```typescript
Resource.find({ entry: entryId, isInvalid: { $ne: true } })
```

### Find Orphaned Blocks

```typescript
Block.find({ linkCount: 0, isInvalid: false })
```

### Find Duplicate SHA256

```typescript
Block.aggregate([
  { $match: { isInvalid: false } },
  { $group: { _id: '$sha256', count: { $sum: 1 } } },
  { $match: { count: { $gt: 1 } } }
])
```

---

## Implementation Checklist

When implementing models, ensure:

- [ ] All timestamps use Unix milliseconds
- [ ] All models have `isInvalid` and `invalidatedAt` fields
- [ ] Unique indexes are partial (only for valid records)
- [ ] Foreign keys are properly typed as ObjectId
- [ ] Soft delete is enforced in queries
- [ ] LinkCount is properly maintained
- [ ] TTL indexes are set for LogEntry (90 days)
