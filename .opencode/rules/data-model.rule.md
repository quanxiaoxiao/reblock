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

```
DATA STRUCTURE Entry:
- id: ObjectId (Unique identifier)
- name: String (Display name, trimmed)
- alias: String (URL-friendly identifier, trimmed)
- isDefault: Boolean (Only one default entry allowed, defaults to false)
- order: Number (Optional display order)
- description: String (Description text, defaults to '')
- uploadConfig: UploadConfig (Optional upload restrictions)
- createdAt: Number (Unix timestamp in ms, auto-generated)
- updatedAt: Number (Unix timestamp in ms, auto-generated)
- isInvalid: Boolean (Soft delete flag, defaults to false)
- invalidatedAt: Number (Unix timestamp when soft deleted, optional)

DATA STRUCTURE UploadConfig:
- maxFileSize: Number (Optional file size limit)
- allowedMimeTypes: Array[String] (Optional array of allowed MIME types)
- readOnly: Boolean (Flag for read-only access, defaults to false)
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

```
DATA STRUCTURE Resource:
- id: ObjectId (Unique identifier)
- block: ObjectId or Block (Reference to Block entity)
- entry: ObjectId or Entry (Reference to Entry entity)
- name: String (Display name, defaults to '')
- mime: String (Optional MIME type, e.g., "image/png")
- category: String (Optional category for grouping)
- description: String (Description text, defaults to '')
- createdAt: Number (Unix timestamp in ms, auto-generated)
- updatedAt: Number (Unix timestamp in ms, auto-generated)
- lastAccessedAt: Number (Last download/access time, auto-generated)
- isInvalid: Boolean (Soft delete flag, defaults to false)
- invalidatedAt: Number (Unix timestamp when soft deleted, optional)
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

```
DATA STRUCTURE LogEntry:
- id: ObjectId (Unique identifier)
- timestamp: Number (Unix timestamp when log created)
- level: Enum LogLevel (CRITICAL, ERROR, WARNING, INFO)
- category: Enum LogCategory (Category of the issue)
- blockId: Optional ObjectId (Associated block ID)
- blockSha256: Optional String (Block content SHA256 for quick lookup)
- resourceIds: Optional Array[ObjectId] (Affected resource IDs)
- entryIds: Optional Array[ObjectId] (Affected entry IDs)
- details: Optional Map[String, Unknown] (Additional details about the issue)
- actualState: Optional Object (Actual state information)
  - refCount: Optional Number (Actual reference count)
  - fileExists: Optional Boolean (Physical file existence)
  - fileSize: Optional Number (Actual file size)
  - duplicateBlocks: Optional Array[ObjectId] (Other blocks with same SHA256)
- context: Object (Context information)
  - detectedBy: String (Source of detection: doctor, cleanup, resourceService, uploadService, system)
  - detectedAt: Number (Detection timestamp)
  - scriptVersion: Optional String (Version of detection script)
  - serverVersion: Optional String (Application version)
  - environment: Enum ('development', 'production', 'test') (Execution environment)
  - originalCreatedAt: Optional Number (Original creation timestamp)
  - daysSinceCreation: Optional Number (Age in days)
  - lastAccessedAt: Optional Number (Last access time)
  - stackTrace: Optional String (Error stack trace)
  - requestId: Optional String (HTTP request ID for tracing)
  - userAgent: Optional String (Client user agent)
- suggestedAction: Optional String (Human-readable recommended action)
- recoverable: Optional Boolean (Whether issue can be recovered)
- dataLossRisk: Optional Enum DataLossRisk ('none', 'low', 'medium', 'high') (Data loss risk level)
- recoverySteps: Optional Array[String] (Step-by-step recovery instructions)
- status: Enum ('open', 'acknowledged', 'resolved', 'ignored') (Log status)
- statusHistory: Optional Array[Object] (History of status changes)
  - status: String (Changed status)
  - changedAt: Number (Time of change)
  - changedBy: Optional String (Who made the change)
  - note: Optional String (Additional notes)
- resolvedAt: Optional Number (Resolution timestamp)
- resolution: Optional String (Resolution description)
- resolvedBy: Optional String (Resolver identity)
- createdAt: Number (Entity creation timestamp)
- expiresAt: Number (Expiration timestamp, TTL: 90 days)
```

### Enums

```
ENUM LogLevel:
- CRITICAL: 'CRITICAL'
- ERROR: 'ERROR'
- WARNING: 'WARNING'
- INFO: 'INFO'

ENUM LogCategory:
- ORPHANED_BLOCK: 'ORPHANED_BLOCK'
- MISSING_FILE: 'MISSING_FILE'
- DUPLICATE_SHA256: 'DUPLICATE_SHA256'
- LINKCOUNT_MISMATCH: 'LINKCOUNT_MISMATCH'
- FILE_SIZE_MISMATCH: 'FILE_SIZE_MISMATCH'
- CLEANUP_ACTION: 'CLEANUP_ACTION'
- CLEANUP_ERROR: 'CLEANUP_ERROR'
- RUNTIME_ERROR: 'RUNTIME_ERROR'
- DATA_INCONSISTENCY: 'DATA_INCONSISTENCY'

ENUM DataLossRisk:
- NONE: 'none'
- LOW: 'low'
- MEDIUM: 'medium'
- HIGH: 'high'
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
