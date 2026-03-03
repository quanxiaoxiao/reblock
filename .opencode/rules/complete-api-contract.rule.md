# Complete API Contract Rule

This document defines the complete API contract for all endpoints in the Reblock service.

---

## Base URL

```
Development: http://localhost:3000
Production:  https://your-domain.com
```

---

## Common Types

### Pagination

```
DATA STRUCTURE PaginatedResponse:
- items: Array[T] (Array of requested entities)
- total: Number (Total count, regardless of pagination)
- limit: Optional Number (Items per page)
- offset: Optional Number (0-based starting index)
```

### Error Response

```
DATA STRUCTURE ErrorResponse:
- error: String (Human-readable error message)
- code: Optional String (Error code for programmatic handling)
```

### Timestamp Fields (All Entities)

```
DATA STRUCTURE TimestampFields:
- createdAt: Number (Unix timestamp in ms)
- updatedAt: Number (Unix timestamp in ms)

DATA STRUCTURE SoftDeleteFields:
- isInvalid: Boolean (True means soft deleted)
- invalidatedAt: Optional Number (Unix timestamp when deleted)
```

---

## Entries API

### List Entries

```
GET /entries
```

**Query Parameters:**

| Parameter | Type     | Required | Description                    |
|-----------|----------|----------|--------------------------------|
| limit     | number   | No       | Items per page (default: 50)  |
| offset    | number   | No       | 0-based starting index        |
| alias     | string   | No       | Filter by alias                |
| isDefault | boolean  | No       | Filter by default entry        |

**Response (200):**

```typescript
{
  items: Entry[];
  total: number;
  limit?: number;
  offset?: number;
}
```

**Entry Schema:**

```typescript
interface Entry {
  _id: string;
  name: string;
  alias: string;
  isDefault: boolean;
  order?: number;
  description: string;
  uploadConfig?: {
    maxFileSize?: number;
    allowedMimeTypes?: string[];
    readOnly: boolean;
  };
  createdAt: number;
  updatedAt: number;
  isInvalid: boolean;
  invalidatedAt?: number;
}
```

**Errors:**

| Status | Description           |
|--------|----------------------|
| 500    | Internal server error |

---

### Get Entry

/:id
```

```
GET /entries**Path Parameters:**

| Parameter | Type   | Required | Description      |
|-----------|--------|----------|------------------|
| id        | string | Yes      | Entry ObjectId   |

**Response (200):** Entry object

**Errors:**

| Status | Description              |
|--------|-------------------------|
| 404    | Entry not found         |
| 500    | Internal server error   |

---

### Create Entry

```
POST /entries
```

**Request Body:**

```typescript
interface CreateEntryRequest {
  name: string;           // Required
  alias?: string;         // Optional, defaults to ''
  isDefault?: boolean;    // Optional, default false
  order?: number;         // Optional
  description?: string;  // Optional, defaults to ''
  uploadConfig?: {
    maxFileSize?: number;
    allowedMimeTypes?: string[];
    readOnly?: boolean;
  };
}
```

**Constraints:**

- Only ONE entry can have `isDefault: true` at a time
- `alias` must be unique among valid (non-deleted) entries
- `name` is required and trimmed
- `maxFileSize` - Maximum file size in bytes
- `allowedMimeTypes` - Array of MIME type patterns (e.g., `["image/*", "video/mp4"]`)

**Response (201):** Created entry object

**Errors:**

| Status | Description                    |
|--------|-------------------------------|
| 400    | Validation error              |
| 409    | Conflict - duplicate alias or default |
| 500    | Internal server error         |

**Example Request:**

```json
{
  "name": "Photos",
  "alias": "photos",
  "description": "User photo storage",
  "uploadConfig": {
    "maxFileSize": 10485760,
    "allowedMimeTypes": ["image/*"],
    "readOnly": false
  }
}
```

---

### Update Entry

```
PUT /entries/:id
```

**Path Parameters:**

| Parameter | Type   | Required | Description      |
|-----------|--------|----------|------------------|
| id        | string | Yes      | Entry ObjectId   |

**Request Body:**

```typescript
interface UpdateEntryRequest {
  name?: string;
  alias?: string;
  isDefault?: boolean;
  order?: number;
  description?: string;
  uploadConfig?: {
    maxFileSize?: number;
    allowedMimeTypes?: string[];
    readOnly?: boolean;
  };
}
```

**Constraints:**

- Cannot update `isInvalid`, `invalidatedAt`, `createdAt`, `updatedAt`
- These are server-controlled fields

**Response (200):** Updated entry object

**Errors:**

| Status | Description                    |
|--------|-------------------------------|
| 400    | Validation error              |
| 404    | Entry not found               |
| 409    | Conflict - duplicate alias    |
| 500    | Internal server error         |

---

### Delete Entry (Soft Delete)

```
DELETE /entries/:id
```

**Path Parameters:**

| Parameter | Type   | Required | Description      |
|-----------|--------|----------|------------------|
| id        | string | Yes      | Entry ObjectId   |

**Response (204):** No Content - Entry successfully soft-deleted

**Cascade Behavior:**

- Soft-deleting an entry does NOT automatically delete associated resources
- Resources remain valid but become "orphaned" (not referenced by any valid entry)
- Use `doctor` script to detect orphaned resources

**Errors:**

| Status | Description              |
|--------|-------------------------|
| 404    | Entry not found         |
| 500    | Internal server error   |

---

## Resources API

### List Resources

```
GET /resources
```

**Query Parameters:**

| Parameter   | Type     | Required | Description                    |
|-------------|----------|----------|--------------------------------|
| limit       | number   | No       | Items per page (default: 50)  |
| offset      | number   | No       | 0-based starting index        |
| entry       | string   | No       | Filter by entry ID            |
| category    | string   | No       | Filter by category            |
| mime        | string   | No       | Filter by MIME type           |

**Response (200):**

```typescript
{
  items: Resource[];
  total: number;
  limit?: number;
  offset?: number;
}
```

**Resource Schema:**

```typescript
interface Resource {
  _id: string;
  block: string;           // Block ObjectId
  entry: string;           // Entry ObjectId
  name?: string;
  mime?: string;
  category?: string;
  description?: string;
  sha256?: string;         // Populated from block
  createdAt: number;
  updatedAt: number;
  lastAccessedAt: number;
  isInvalid: boolean;
  invalidatedAt?: number;
}
```

**Errors:**

| Status | Description              |
|--------|-------------------------|
| 500    | Internal server error   |

---

### Get Resource

```
GET /resources/:id
```

**Path Parameters:**

| Parameter | Type   | Required | Description       |
|-----------|--------|----------|-------------------|
| id        | string | Yes      | Resource ObjectId |

**Response (200):** Resource object with `sha256` populated from block

**Errors:**

| Status | Description              |
|--------|-------------------------|
| 404    | Resource not found      |
| 500    | Internal server error   |

---

### Update Resource

```
PUT /resources/:id
```

**Path Parameters:**

| Parameter | Type   | Required | Description       |
|-----------|--------|----------|-------------------|
| id        | string | Yes      | Resource ObjectId |

**Request Body:**

```typescript
interface UpdateResourceRequest {
  name?: string;
  description?: string;
  category?: string;
  entry?: string;        // Move to different entry
  mime?: string;
  block?: string;        // Change associated block
}
```

**Constraints:**

- Cannot update `isInvalid`, `invalidatedAt`, `createdAt`, `updatedAt`, `lastAccessedAt`
- Changing `block` affects linkCount on both old and new blocks

**Response (200):** Updated resource object

**Errors:**

| Status | Description              |
|--------|-------------------------|
| 400    | Validation error        |
| 404    | Resource not found      |
| 500    | Internal server error   |

---

### Delete Resource (Soft Delete)

```
DELETE /resources/:id
```

**Path Parameters:**

| Parameter | Type   | Required | Description       |
|-----------|--------|----------|-------------------|
| id        | string | Yes      | Resource ObjectId |

**Response (204):** No Content - Resource successfully soft-deleted

**Cascade Behavior:**

- Soft-deleting a resource decrements the linked Block's `linkCount`
- If linkCount reaches 0, the block is NOT automatically deleted
- Use `doctor` script to detect orphaned blocks

**Errors:**

| Status | Description              |
|--------|-------------------------|
| 404    | Resource not found      |
| 500    | Internal server error   |

---

### Download Resource

```
GET /resources/:id/download
```

**Path Parameters:**

| Parameter | Type   | Required | Description       |
|-----------|--------|----------|-------------------|
| id        | string | Yes      | Resource ObjectId |

**Query Parameters:**

| Parameter | Type     | Required | Description                           |
|-----------|----------|----------|---------------------------------------|
| inline    | boolean  | No       | If true, stream inline (for video)   |

**Request Headers:**

| Header  | Required | Description                    |
|---------|----------|--------------------------------|
| Range   | No       | HTTP Range request (bytes=n-m) |

**Response:**

- **200 OK:** Full content, binary body, `Content-Length: <size>`
- **206 Partial Content:** Range request successful, partial binary, `Content-Range: bytes start-end/size`
- **200 OK (inline):** Streaming with appropriate `Content-Type` for video/audio

**Response Headers:**

```
Content-Type: <resource.mime>
Content-Length: <size or partial size>
Content-Range: bytes <start>-<end>/<total>  (if range request)
Accept-Ranges: bytes
```

**Errors:**

| Status | Description                        |
|--------|-----------------------------------|
| 404    | Resource not found                |
| 416    | Range Not Satisfiable (invalid range) |
| 500    | Internal server error             |

**Range Request Example:**

```
Request:
  Range: bytes=0-1023

Response:
  206 Partial Content
  Content-Range: bytes 0-1023/2048
  Content-Length: 1024
```

---

## Upload API

### Upload to Default Entry

```
POST /upload
```

**Content-Type:** `multipart/form-data`

**Form Fields:**

| Field   | Type   | Required | Description              |
|---------|--------|----------|-------------------------|
| file    | binary | Yes      | File to upload          |

**Response (201):**

```typescript
{
  resource: Resource;
  block: {
    _id: string;
    sha256: string;
    size: number;
    linkCount: number;
  };
  isNewBlock: boolean;  // true = new block created, false = reused existing
}
```

**Errors:**

| Status | Description                                          |
|--------|------------------------------------------------------|
| 400    | Validation error (includes file size, MIME type)     |
| 500    | Internal server error                                |

---

### Upload to Specific Entry

```
POST /upload/:alias
```

**Path Parameters:**

| Parameter | Type   | Required | Description         |
|-----------|--------|----------|--------------------|
| alias     | string | Yes      | Entry alias        |

**Content-Type:** `multipart/form-data`

**Form Fields:**

| Field   | Type   | Required | Description              |
|---------|--------|----------|-------------------------|
| file    | binary | Yes      | File to upload          |

**Entry Configuration Enforcement:**

- If entry has `uploadConfig.maxFileSize`: rejects files exceeding limit
- If entry has `uploadConfig.allowedMimeTypes`: rejects disallowed types
- If entry has `uploadConfig.readOnly`: rejects upload (403)

**Response (201):** Same as upload to default entry

**Errors:**

| Status | Description                                          |
|--------|------------------------------------------------------|
| 400    | Validation error (includes file size, MIME type)     |
| 403    | Entry is read-only                                   |
| 404    | Entry not found                                      |
| 500    | Internal server error                                |

---

## Blocks API

### List Blocks

```
GET /blocks
```

**Query Parameters:**

| Parameter | Type     | Required | Description                    |
|-----------|----------|----------|--------------------------------|
| limit     | number   | No       | Items per page (default: 50)  |
| offset    | number   | No       | 0-based starting index        |
| sha256    | string   | No       | Filter by SHA256 hash         |

**Response (200):**

```typescript
{
  items: Block[];
  total: number;
  limit?: number;
  offset?: number;
}
```

**Block Schema:**

```typescript
interface Block {
  _id: string;
  sha256: string;
  linkCount: number;
  size: number;
  createdAt: number;
  updatedAt: number;
  isInvalid: boolean;
  invalidatedAt?: number;
}
```

---

### Get Block

```
GET /blocks/:id
```

**Path Parameters:**

| Parameter | Type   | Required | Description     |
|-----------|--------|----------|----------------|
| id        | string | Yes      | Block ObjectId |

**Response (200):** Block object

**Errors:**

| Status | Description              |
|--------|-------------------------|
| 404    | Block not found         |
| 500    | Internal server error   |

---

## Health Check

### Health

```
GET /health
```

**Response (200):**

```typescript
{
  status: 'ok';
  timestamp: number;
  uptime: number;
}
```

---

## OpenAPI Documentation

### Get OpenAPI Spec

```
GET /openapi.json
```

Returns the OpenAPI 3.0 specification in JSON format.

---

### Interactive Docs

```
GET /docs
```

Returns HTML page with Scalar API reference UI for interactive API exploration.

---

## API Versioning

Current API Version: **v1**

All endpoints use `/` prefix (no `/api/v1/` prefix in current version).

Future versions will be available at `/v2/`, `/v3/`, etc.

---

## Rate Limiting

Currently **NOT implemented**. Future versions may include rate limiting.

---

## Authentication

Currently **NOT implemented**. The service is designed for internal use.

For production deployment, implement authentication middleware (OAuth2, API keys, etc.).

---

## Error API

Runtime error tracking and management endpoints.

### Authentication

All endpoints require `x-errors-token` header when `ERRORS_API_TOKEN` is configured.

**401 Unauthorized:** Returned when token is missing or invalid.

---

### List Errors

```
GET /errors
```

List runtime errors with pagination and filtering.

**Query Parameters:**

| Parameter | Type    | Required | Description                                    |
|-----------|---------|----------|------------------------------------------------|
| status    | string  | No       | Filter by status: 'open', 'acknowledged', 'resolved' |
| category  | string  | No       | Error category filter                          |
| level     | string  | No       | Error level: 'CRITICAL', 'ERROR', 'WARNING', 'INFO' |
| limit     | number  | No       | Items per page (default: 20)                   |
| offset    | number  | No       | 0-based pagination offset                      |

**Response (200):**

```typescript
{
  items: LogEntry[];
  total: number;
  limit?: number;
  offset?: number;
}
```

---

### Get Error Detail

```
GET /errors/:id
```

Get detailed information about a specific error.

**Path Parameters:**

| Parameter | Type   | Required | Description       |
|-----------|--------|----------|-------------------|
| id        | string | Yes      | Error log entry ID |

**Response (200):** LogEntry detail

**Response (404):** Error not found

---

### Export Error

```
GET /errors/:id/export
```

Export error data for external analysis.

**Path Parameters:**

| Parameter | Type   | Required | Description       |
|-----------|--------|----------|-------------------|
| id        | string | Yes      | Error log entry ID |

**Response (200):** Exported error data

**Response (404):** Error not found

---

### Acknowledge Error

```
POST /errors/:id/acknowledge
```

Mark error as acknowledged (under investigation).

**Path Parameters:**

| Parameter | Type   | Required | Description       |
|-----------|--------|----------|-------------------|
| id        | string | Yes      | Error log entry ID |

**Request Body:**

| Field | Type   | Required | Description                |
|-------|--------|----------|----------------------------|
| note  | string | No       | Optional acknowledgment note |

**Response (200):** Updated LogEntry

**Response (404):** Error not found

---

### Resolve Error

```
POST /errors/:id/resolve
```

Mark error as resolved.

**Path Parameters:**

| Parameter | Type   | Required | Description       |
|-----------|--------|----------|-------------------|
| id        | string | Yes      | Error log entry ID |

**Request Body:**

| Field      | Type   | Required | Description              |
|------------|--------|----------|--------------------------|
| resolution | string | Yes      | Description of resolution |
| resolvedBy | string | No       | User/system who resolved  |

**Response (200):** Updated LogEntry

**Response (404):** Error not found

---

### Create Test Error

```
POST /errors/test/create
```

Create a test error for testing error handling (development only).

**Response (201):** Test error created successfully

**Response (403):** Forbidden in production environment

---

## Implementation Checklist

When implementing or reconstructing this API, ensure:

- [ ] All timestamps use Unix milliseconds (`Date.now()`)
- [ ] All delete operations use soft delete (`isInvalid: true`)
- [ ] Pagination uses 0-based offset
- [ ] All queries filter out soft-deleted records by default
- [ ] LinkCount is properly maintained on block references
- [ ] HTTP Range requests work for video/audio streaming
- [ ] Upload respects entry's upload configuration
- [ ] Error responses follow consistent format
