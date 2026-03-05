# Service Interface Rule

This document defines the complete interface for all services in the Reblock service.

---

## Common Types

### PaginatedResult

A paginated result contains items and pagination metadata.

```json
{
  "items": [...],
  "total": 42,
  "limit": 10,
  "offset": 0
}
```

### Filter

A generic filter object for querying entities.

---

## BlockService

### Methods

| Method | Description |
|--------|-------------|
| `create(blockData)` | Create a new block |
| `update(id, blockData)` | Update an existing block |
| `getById(id)` | Get a block by ID |
| `list(filter, limit, offset)` | List blocks with pagination |
| `delete(id)` | Soft delete a block |

### Key Behaviors

- All queries filter out soft-deleted blocks by default
- Timestamps are auto-injected on create/update
- Server-controlled fields are stripped from user input
- Pagination uses stable sorting (`createdAt DESC, _id DESC`)

### HTTP Examples

#### Create Block

```http
POST /blocks
Content-Type: application/json

{
  "sha256": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0",
  "size": 1024000
}

HTTP 201 Created
{
  "_id": "60d21b4667d0d8992e610c85",
  "sha256": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0",
  "size": 1024000,
  "linkCount": 1,
  "createdAt": 1772241136645,
  "updatedAt": 1772241136645,
  "isInvalid": false
}
```

#### Get Block by ID

```http
GET /blocks/60d21b4667d0d8992e610c85

HTTP 200 OK
{
  "_id": "60d21b4667d0d8992e610c85",
  "sha256": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0",
  "size": 1024000,
  "linkCount": 3,
  "createdAt": 1772241136645,
  "updatedAt": 1772242000000,
  "isInvalid": false
}
```

#### List Blocks

```http
GET /blocks?limit=10&offset=0

HTTP 200 OK
{
  "items": [
    {
      "_id": "60d21b4667d0d8992e610c85",
      "sha256": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0",
      "size": 1024000,
      "linkCount": 3,
      "createdAt": 1772241136645,
      "updatedAt": 1772242000000,
      "isInvalid": false
    }
  ],
  "total": 42,
  "limit": 10,
  "offset": 0
}
```

#### Delete Block (Soft Delete)

```http
DELETE /blocks/60d21b4667d0d8992e610c85

HTTP 204 No Content
```

---

## EntryService

### Methods

| Method | Description |
|--------|-------------|
| `create(entryData)` | Create a new entry |
| `update(id, entryData)` | Update an existing entry |
| `getById(id)` | Get an entry by ID |
| `getDefault()` | Get the default entry |
| `list(filter, limit, offset)` | List entries with pagination |
| `delete(id)` | Soft delete an entry |

### Key Behaviors

- Business uniqueness check for alias on create/update
- If setting as default, unset any existing default first
- Only one entry can be default at a time

### HTTP Examples

#### Create Entry

```http
POST /entries
Content-Type: application/json

{
  "name": "My Documents",
  "alias": "my-docs",
  "description": "Personal document storage",
  "isDefault": false
}

HTTP 201 Created
{
  "_id": "60d21b4667d0d8992e610c85",
  "name": "My Documents",
  "alias": "my-docs",
  "description": "Personal document storage",
  "isDefault": false,
  "createdAt": 1772241136645,
  "updatedAt": 1772241136645,
  "isInvalid": false
}
```

#### Set Default Entry

```http
PUT /entries/60d21b4667d0d8992e610c85
Content-Type: application/json

{
  "isDefault": true
}

HTTP 200 OK
{
  "_id": "60d21b4667d0d8992e610c85",
  "name": "My Documents",
  "alias": "my-docs",
  "isDefault": true,
  "updatedAt": 1772242000000
}
```

#### Get Default Entry

```http
GET /entries/default

HTTP 200 OK
{
  "_id": "60d21b4667d0d8992e610c85",
  "name": "My Documents",
  "alias": "my-docs",
  "isDefault": true,
  "createdAt": 1772241136645,
  "updatedAt": 1772242000000,
  "isInvalid": false
}
```

#### Alias Conflict Error

```http
POST /entries
Content-Type: application/json

{
  "name": "Another Entry",
  "alias": "my-docs"
}

HTTP 409 Conflict
{
  "error": "alias already exists",
  "code": "ALIAS_EXISTS"
}
```

---

## ResourceService

### Methods

| Method | Description |
|--------|-------------|
| `create(resourceData)` | Create a new resource |
| `update(id, resourceData)` | Update an existing resource |
| `getById(id)` | Get a resource by ID |
| `list(filter, limit, offset)` | List resources with pagination |
| `delete(id)` | Soft delete a resource |
| `download(id, range)` | Prepare resource for download |
| `downloadMeta(id)` | Get resource download metadata (totalSize, mime, filename) without stream setup — used for Range pre-checks |

### Key Behaviors

- Resources reference blocks and entries
- Block linkCount is maintained on resource create/delete
- Soft delete only (no physical deletion)
- lastAccessedAt is updated on download

### HTTP Examples

#### Create Resource

```http
POST /resources
Content-Type: application/json

{
  "block": "60d21b4667d0d8992e610c86",
  "entry": "60d21b4667d0d8992e610c85",
  "name": "document.pdf",
  "mime": "application/pdf",
  "category": "documents",
  "description": "Important document"
}

HTTP 201 Created
{
  "_id": "60d21b4667d0d8992e610c87",
  "block": "60d21b4667d0d8992e610c86",
  "entry": "60d21b4667d0d8992e610c85",
  "name": "document.pdf",
  "mime": "application/pdf",
  "category": "documents",
  "description": "Important document",
  "createdAt": 1772241136645,
  "updatedAt": 1772241136645,
  "lastAccessedAt": 1772241136645,
  "isInvalid": false,
  "sha256": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0"
}
```

#### Get Resource by ID

```http
GET /resources/60d21b4667d0d8992e610c87

HTTP 200 OK
{
  "_id": "60d21b4667d0d8992e610c87",
  "block": "60d21b4667d0d8992e610c86",
  "entry": "60d21b4667d0d8992e610c85",
  "name": "document.pdf",
  "mime": "application/pdf",
  "createdAt": 1772241136645,
  "updatedAt": 1772241136645,
  "lastAccessedAt": 1772241136645,
  "isInvalid": false,
  "sha256": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0"
}
```

#### Download Resource

```http
GET /resources/60d21b4667d0d8992e610c87/download

HTTP 200 OK
Content-Type: application/pdf
Content-Length: 1024000
Content-Disposition: attachment; filename="document.pdf"
Accept-Ranges: bytes

[binary file content]
```

#### Download with Range

```http
GET /resources/60d21b4667d0d8992e610c87/download
Range: bytes=0-1023

HTTP 206 Partial Content
Content-Type: application/pdf
Content-Length: 1024
Content-Range: bytes 0-1023/1024000
Accept-Ranges: bytes

[partial binary content]
```

#### Delete Resource

```http
DELETE /resources/60d21b4667d0d8992e610c87

HTTP 204 No Content
```

---

## UploadService

### Methods

| Method | Description |
|--------|-------------|
| `processUpload(alias, tempFilePath, name, mime)` | Process a file upload |

### Upload Process Flow

1. Validate entry exists and is not read-only
2. Validate file size against upload config (cheap — early rejection for oversized files)
3. Compute SHA256 hash of file (expensive — only after size check passes)
4. Detect MIME type
5. Validate MIME type against upload config
6. Handle block deduplication (reuse or create new)
7. Create resource referencing the block

### HTTP Example

```http
POST /upload/my-docs?name=report.pdf
Content-Type: application/octet-stream

[binary file content]

HTTP 201 Created
{
  "_id": "60d21b4667d0d8992e610c88",
  "block": "60d21b4667d0d8992e610c89",
  "entry": "60d21b4667d0d8992e610c85",
  "name": "report.pdf",
  "mime": "application/pdf",
  "createdAt": 1772241136645,
  "updatedAt": 1772241136645,
  "lastAccessedAt": 1772241136645,
  "isInvalid": false,
  "clientIp": "192.168.1.100",
  "userAgent": "Mozilla/5.0...",
  "uploadDuration": 1234
}
```

### Upload Errors

#### Read-only Entry

```http
POST /upload/read-only-entry
Content-Type: application/octet-stream

[binary file content]

HTTP 403 Forbidden
{
  "error": "Entry is read-only",
  "code": "ENTRY_READ_ONLY"
}
```

#### File Too Large

```http
POST /upload/my-docs
Content-Type: application/octet-stream

[11MB file content]

HTTP 413 Payload Too Large
{
  "error": "File too large",
  "code": "FILE_TOO_LARGE"
}
```

#### Invalid MIME Type

```http
POST /upload/my-docs
Content-Type: application/exe

[executable file content]

HTTP 415 Unsupported Media Type
{
  "error": "File type not allowed",
  "code": "INVALID_MIME_TYPE"
}
```

---

## LogService

### Methods

| Method | Description |
|--------|-------------|
| `logIssue(params)` | Log a detected issue |
| `logCleanupAction(params)` | Log a cleanup action |
| `checkDuplicate(category, blockId, sinceHours)` | Check for duplicate issues |
| `findByBlockId(blockId, limit)` | Find logs by block ID |
| `findOpenIssues(category?, limit?)` | Find open issues (default limit: 200, max: 1000) |
| `findRecent(days, filter)` | Find recent logs |
| `markResolved(logId, resolution, resolvedBy)` | Mark issue as resolved |
| `markAcknowledged(logId, note)` | Mark issue as acknowledged |
| `generateSummary()` | Generate log summary |

### Key Behaviors

- Dual storage: MongoDB + JSON Lines files
- TTL: 90 days automatic cleanup
- Status tracking: open → acknowledged → resolved/ignored
- Duplicate detection within configurable time window

### HTTP Examples

#### Log an Issue

```http
POST /errors
Content-Type: application/json

{
  "level": "ERROR",
  "category": "ORPHANED_BLOCK",
  "blockId": "60d21b4667d0d8992e610c86",
  "details": {
    "reason": "linkCount=0 but not soft deleted",
    "sha256": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0",
    "size": 1024000
  },
  "suggestedAction": "Soft delete this block using cleanup tool",
  "recoverable": true,
  "dataLossRisk": "none",
  "recoverySteps": ["Run cleanup to soft delete orphaned blocks"],
  "context": {
    "detectedBy": "doctor",
    "detectedAt": 1772241136645,
    "environment": "development"
  }
}

HTTP 201 Created
{
  "_id": "60d21b4667d0d8992e610c90",
  "timestamp": 1772241136645,
  "level": "ERROR",
  "category": "ORPHANED_BLOCK",
  "status": "open",
  "createdAt": 1772241136645,
  "expiresAt": 1779993136645
}
```

#### Acknowledge an Issue

```http
POST /errors/60d21b4667d0d8992e610c90/acknowledge
Content-Type: application/json

{
  "note": "Confirmed this is a valid orphaned block",
  "changedBy": "admin-123"
}

HTTP 200 OK
{
  "_id": "60d21b4667d0d8992e610c90",
  "status": "acknowledged",
  "statusHistory": [
    {
      "status": "acknowledged",
      "changedAt": 1772242000000,
      "changedBy": "admin-123",
      "note": "Confirmed this is a valid orphaned block"
    }
  ],
  "updatedAt": 1772242000000
}
```

#### Resolve an Issue

```http
POST /errors/60d21b4667d0d8992e610c90/resolve
Content-Type: application/json

{
  "resolution": "Soft deleted via cleanup script",
  "resolvedBy": "cleanup-script",
  "note": "Cleanup executed successfully"
}

HTTP 200 OK
{
  "_id": "60d21b4667d0d8992e610c90",
  "status": "resolved",
  "resolvedAt": 1772243000000,
  "resolution": "Soft deleted via cleanup script",
  "resolvedBy": "cleanup-script",
  "statusHistory": [
    {
      "status": "acknowledged",
      "changedAt": 1772242000000,
      "changedBy": "admin-123",
      "note": "Confirmed this is a valid orphaned block"
    },
    {
      "status": "resolved",
      "changedAt": 1772243000000,
      "changedBy": "cleanup-script",
      "note": "Cleanup executed successfully"
    }
  ],
  "updatedAt": 1772243000000
}
```

#### List Recent Issues

```http
GET /errors?days=7&status=open

HTTP 200 OK
{
  "items": [
    {
      "_id": "60d21b4667d0d8992e610c90",
      "timestamp": 1772241136645,
      "level": "ERROR",
      "category": "ORPHANED_BLOCK",
      "status": "open",
      "blockId": "60d21b4667d0d8992e610c86"
    }
  ],
  "total": 5,
  "limit": 1000,
  "offset": 0
}
```

---

## Implementation Checklist

When implementing services, ensure:

- [ ] All CRUD operations follow the interface signature
- [ ] Timestamps are injected in service layer
- [ ] Soft delete filtering is applied to all queries
- [ ] Server-controlled fields are stripped from user input
- [ ] Pagination uses stable sorting
- [ ] LinkCount is properly maintained in ResourceService
- [ ] Duplicate detection is implemented in LogService
- [ ] Dual storage (MongoDB + JSONL) is implemented in LogService
- [ ] Errors throw appropriate custom error types
