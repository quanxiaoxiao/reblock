# API Examples

This document provides complete request/response examples for all Reblock API endpoints.

---

## Table of Contents

1. [Health Check](#health-check)
2. [Entry API Examples](#entry-api-examples)
3. [Resource API Examples](#resource-api-examples)
4. [Block API Examples](#block-api-examples)
5. [Upload API Examples](#upload-api-examples)
6. [Overload Protection & Metrics Examples](#overload-protection--metrics-examples)
7. [Error API Examples](#error-api-examples)

---

## Health Check

### GET /health (Healthy)

```bash
curl http://localhost:3000/health

# Response (200):
{
  "status": "healthy",
  "timestamp": "2026-03-05T00:00:00.000Z",
  "database": "connected"
}
```

### GET /health (Database disconnected)

```bash
curl http://localhost:3000/health

# Response (503):
{
  "status": "degraded",
  "timestamp": "2026-03-05T00:00:00.000Z",
  "database": "disconnected"
}
```

---

## Entry API Examples

### Create Entry

**Request:**
```bash
curl -X POST "http://localhost:3000/entries" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Documents",
    "alias": "my-docs",
    "description": "Personal document storage",
    "isDefault": false,
    "uploadConfig": {
      "maxFileSize": 10485760,
      "allowedMimeTypes": ["application/pdf", "image/*"],
      "readOnly": false
    }
  }'
```

**Success Response (201 Created):**
```json
{
  "_id": "60d21b4667d0d8992e610c85",
  "name": "My Documents",
  "alias": "my-docs",
  "description": "Personal document storage",
  "isDefault": false,
  "createdAt": 1772241136645,
  "updatedAt": 1772241136645,
  "isInvalid": false,
  "uploadConfig": {
    "maxFileSize": 10485760,
    "allowedMimeTypes": ["application/pdf", "image/*"],
    "readOnly": false
  }
}
```

---

### Update Entry

**Request:**
```bash
curl -X PUT "http://localhost:3000/entries/60d21b4667d0d8992e610c85" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Updated Documents",
    "description": "Updated description",
    "uploadConfig": {
      "maxFileSize": 52428800,
      "readOnly": false
    }
  }'
```

**Success Response (200 OK):**
```json
{
  "_id": "60d21b4667d0d8992e610c85",
  "name": "My Updated Documents",
  "alias": "my-docs",
  "description": "Updated description",
  "isDefault": false,
  "createdAt": 1772241136645,
  "updatedAt": 1772242000000,
  "isInvalid": false,
  "uploadConfig": {
    "maxFileSize": 52428800,
    "allowedMimeTypes": ["application/pdf", "image/*"],
    "readOnly": false
  }
}
```

**Not Found Response (404):**
```json
{
  "error": "Entry not found"
}
```

---

### Update Entry Upload Config

**Request:**
```bash
curl -X PATCH "http://localhost:3000/entries/60d21b4667d0d8992e610c85/upload-config" \
  -H "Content-Type: application/json" \
  -d '{
    "maxFileSize": 104857600,
    "allowedMimeTypes": ["image/*", "video/*"],
    "readOnly": false
  }'
```

**Success Response (200 OK):**
```json
{
  "_id": "60d21b4667d0d8992e610c85",
  "name": "My Documents",
  "alias": "my-docs",
  "uploadConfig": {
    "maxFileSize": 104857600,
    "allowedMimeTypes": ["image/*", "video/*"],
    "readOnly": false
  },
  "updatedAt": 1772243000000
}
```

---

## Resource API Examples

### Create Resource

**Request:**
```bash
curl -X POST "http://localhost:3000/resources" \
  -H "Content-Type: application/json" \
  -d '{
    "block": "60d21b4667d0d8992e610c86",
    "entry": "60d21b4667d0d8992e610c85",
    "name": "document.pdf",
    "mime": "application/pdf",
    "category": "documents",
    "description": "Important document"
  }'
```

**Success Response (201 Created):**
```json
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

---

### Update Resource

**Request:**
```bash
curl -X PUT "http://localhost:3000/resources/60d21b4667d0d8992e610c87" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "updated-document.pdf",
    "description": "Updated important document",
    "category": "archives"
  }'
```

**Success Response (200 OK):**
```json
{
  "_id": "60d21b4667d0d8992e610c87",
  "block": "60d21b4667d0d8992e610c86",
  "entry": "60d21b4667d0d8992e610c85",
  "name": "updated-document.pdf",
  "description": "Updated important document",
  "category": "archives",
  "createdAt": 1772241136645,
  "updatedAt": 1772242000000,
  "lastAccessedAt": 1772241136645,
  "isInvalid": false
}
```

**Not Found Response (404):**
```json
{
  "error": "Resource not found"
}
```

---

### Update Resource Block (with Transaction)

**Request:**
```bash
curl -X PATCH "http://localhost:3000/resources/60d21b4667d0d8992e610c87/block" \
  -H "Content-Type: application/json" \
  -d '{
    "newBlockId": "60d21b4667d0d8992e610c88",
    "changedBy": "user-123",
    "reason": "Updating to new version",
    "requestId": "req-abc-123",
    "expectedUpdatedAt": 1772241136645
  }'
```

**Success Response (200 OK):**
```json
{
  "_id": "60d21b4667d0d8992e610c87",
  "block": "60d21b4667d0d8992e610c88",
  "entry": "60d21b4667d0d8992e610c85",
  "name": "document.pdf",
  "updatedAt": 1772243000000
}
```

**Version Conflict Response (409):**
```json
{
  "error": "Resource has been updated by another request",
  "code": "VERSION_CONFLICT"
}
```

---

### Get Resource Block Change History

**Request:**
```bash
curl -X GET "http://localhost:3000/resources/60d21b4667d0d8992e610c87/history?limit=50&offset=0"
```

**Success Response (200 OK):**
```json
{
  "total": 2,
  "items": [
    {
      "_id": "60d21b4667d0d8992e610c89",
      "resourceId": "60d21b4667d0d8992e610c87",
      "fromBlockId": "60d21b4667d0d8992e610c88",
      "toBlockId": "60d21b4667d0d8992e610c86",
      "action": "rollback",
      "changedAt": 1772244000000,
      "changedBy": "user-123",
      "reason": "Rolling back to previous version",
      "requestId": "req-def-456",
      "rollbackable": true
    },
    {
      "_id": "60d21b4667d0d8992e610c90",
      "resourceId": "60d21b4667d0d8992e610c87",
      "fromBlockId": "60d21b4667d0d8992e610c86",
      "toBlockId": "60d21b4667d0d8992e610c88",
      "action": "swap",
      "changedAt": 1772243000000,
      "changedBy": "user-123",
      "reason": "Updating to new version",
      "requestId": "req-abc-123",
      "rollbackable": true
    }
  ]
}
```

---

### Rollback Resource Block

**Request:**
```bash
curl -X POST "http://localhost:3000/resources/60d21b4667d0d8992e610c87/rollback" \
  -H "Content-Type: application/json" \
  -d '{
    "historyId": "60d21b4667d0d8992e610c90",
    "changedBy": "user-123",
    "requestId": "req-ghi-789"
  }'
```

**Success Response (200 OK):**
```json
{
  "_id": "60d21b4667d0d8992e610c87",
  "block": "60d21b4667d0d8992e610c86",
  "updatedAt": 1772245000000
}
```

**Not Found Response (404):**
```json
{
  "error": "Rollback target not found",
  "code": "ROLLBACK_TARGET_NOT_FOUND"
}
```

---

## Block API Examples

### Get Block by ID

**Request:**
```bash
curl -X GET "http://localhost:3000/blocks/60d21b4667d0d8992e610c86"
```

**Success Response (200 OK):**
```json
{
  "_id": "60d21b4667d0d8992e610c86",
  "sha256": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0",
  "size": 1024000,
  "linkCount": 3,
  "createdAt": 1772241136645,
  "updatedAt": 1772242000000,
  "isInvalid": false
}
```

**Not Found Response (404):**
```json
{
  "error": "Block not found"
}
```

---

### List Blocks

**Request:**
```bash
curl -X GET "http://localhost:3000/blocks?limit=10&offset=0"
```

**Success Response (200 OK):**
```json
{
  "items": [
    {
      "_id": "60d21b4667d0d8992e610c86",
      "sha256": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0",
      "size": 1024000,
      "linkCount": 3,
      "createdAt": 1772241136645,
      "updatedAt": 1772242000000,
      "isInvalid": false
    },
    {
      "_id": "60d21b4667d0d8992e610c88",
      "sha256": "b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a",
      "size": 2048000,
      "linkCount": 1,
      "createdAt": 1772241236645,
      "updatedAt": 1772241236645,
      "isInvalid": false
    }
  ],
  "total": 42,
  "limit": 10,
  "offset": 0
}
```

---

## Upload API Examples

### Upload File to Entry

**Request:**
```bash
curl -X POST "http://localhost:3000/upload/my-docs?name=report.pdf" \
  -H "Content-Type: application/pdf" \
  --data-binary @[file_path]
```

**Success Response (201 Created):**
```json
{
  "_id": "60d21b4667d0d8992e610c91",
  "block": "60d21b4667d0d8992e610c92",
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

**Read-only Entry Response (403):**
```json
{
  "error": "Entry is read-only",
  "code": "ENTRY_READ_ONLY"
}
```

**File Too Large Response (413):**
```json
{
  "error": "File too large",
  "code": "FILE_TOO_LARGE"
}
```

**Invalid MIME Type Response (415):**
```json
{
  "error": "File type not allowed",
  "code": "INVALID_MIME_TYPE"
}
```

---

## Overload Protection & Metrics Examples

### Upload Rejected by Admission Control (429)

When server overload protection is active and upload queue is full or queue wait timed out:

**Request:**
```bash
curl -i -X POST "http://localhost:3000/upload/my-docs?name=bulk-file.bin" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @[file_path]
```

**Response Headers (example):**
```http
HTTP/1.1 429 Too Many Requests
Retry-After: 15
Content-Type: application/json
```

**Response Body:**
```json
{
  "error": "Server overloaded. Please retry later.",
  "code": "SERVER_OVERLOADED",
  "retryAfterMs": 15000
}
```

### Migration Payload Too Large (413)

Migration endpoint rejects oversized JSON/base64 payload before expensive processing:

**Request:**
```bash
curl -X POST "http://localhost:3000/migration/resources/6906d8085481cd13472265cd" \
  -H "Content-Type: application/json" \
  -H "x-migration-token: your-secret-token" \
  -d '{
    "entryAlias": "notes",
    "name": "huge-image.jpg",
    "contentBase64": "......very_large_base64......"
  }'
```

**Response (413 Payload Too Large):**
```json
{
  "error": "Payload too large",
  "code": "PAYLOAD_TOO_LARGE"
}
```

### Request Timeout / Abort Responses

Under request timeout or aborted connection, heavy routes return deterministic responses:

**Timeout Response (503):**
```json
{
  "error": "Upload request timed out",
  "code": "REQUEST_TIMEOUT"
}
```

**Aborted Response (408):**
```json
{
  "error": "Upload request aborted",
  "code": "REQUEST_ABORTED"
}
```

### Query Runtime Overload Metrics

Use this endpoint to inspect inflight/queue/rejection counters and tune limits:

**Request:**
```bash
curl -X GET "http://localhost:3000/metrics/runtime"
```

**Response (200 OK):**
```json
{
  "timestamp": 1772249000000,
  "admission": [
    {
      "name": "upload",
      "maxInflight": 4,
      "queueMax": 32,
      "queueTimeoutMs": 15000,
      "inflight": 2,
      "queued": 3,
      "admittedTotal": 1024,
      "queuedTotal": 120,
      "rejectedTotal": 12,
      "rejectedQueueFull": 8,
      "rejectedQueueTimeout": 4,
      "totalQueueWaitMs": 18500,
      "maxQueueWaitMs": 1400
    },
    {
      "name": "migration",
      "maxInflight": 1,
      "queueMax": 8,
      "queueTimeoutMs": 10000,
      "inflight": 0,
      "queued": 0,
      "admittedTotal": 220,
      "queuedTotal": 41,
      "rejectedTotal": 6,
      "rejectedQueueFull": 2,
      "rejectedQueueTimeout": 4,
      "totalQueueWaitMs": 9200,
      "maxQueueWaitMs": 1800
    }
  ],
  "counters": {
    "migrationPayloadTooLargeTotal": 3,
    "requestTimeoutTotal": 7,
    "requestAbortedTotal": 11
  }
}
```

---

## Error API Examples

> **Note:** All `/errors` endpoints require authentication via `x-errors-token` header.
> If no token is configured on the server, all requests return **403 Forbidden**.

### Acknowledge an Issue

**Request:**
```bash
curl -X POST "http://localhost:3000/errors/60d21b4667d0d8992e610c93/acknowledge" \
  -H "Content-Type: application/json" \
  -H "x-errors-token: your-api-token-here" \
  -d '{
    "note": "Confirmed this is a valid orphaned block",
    "changedBy": "admin-123"
  }'
```

**Success Response (200 OK):**
```json
{
  "_id": "60d21b4667d0d8992e610c93",
  "status": "acknowledged",
  "statusHistory": [
    {
      "status": "acknowledged",
      "changedAt": 1772246000000,
      "changedBy": "admin-123",
      "note": "Confirmed this is a valid orphaned block"
    }
  ],
  "updatedAt": 1772246000000
}
```

---

### Resolve an Issue

**Request:**
```bash
curl -X POST "http://localhost:3000/errors/60d21b4667d0d8992e610c93/resolve" \
  -H "Content-Type: application/json" \
  -d '{
    "resolution": "Soft deleted the orphaned block via cleanup script",
    "resolvedBy": "cleanup-script",
    "note": "Cleanup executed successfully"
  }'
```

**Success Response (200 OK):**
```json
{
  "_id": "60d21b4667d0d8992e610c93",
  "status": "resolved",
  "resolvedAt": 1772247000000,
  "resolution": "Soft deleted the orphaned block via cleanup script",
  "resolvedBy": "cleanup-script",
  "statusHistory": [
    {
      "status": "acknowledged",
      "changedAt": 1772246000000,
      "changedBy": "admin-123",
      "note": "Confirmed this is a valid orphaned block"
    },
    {
      "status": "resolved",
      "changedAt": 1772247000000,
      "changedBy": "cleanup-script",
      "note": "Cleanup executed successfully"
    }
  ],
  "updatedAt": 1772247000000
}
```

---

### Ignore an Issue

**Request:**
```bash
curl -X POST "http://localhost:3000/errors/60d21b4667d0d8992e610c93/ignore" \
  -H "Content-Type: application/json" \
  -d '{
    "note": "False positive - data was actually consistent",
    "changedBy": "system"
  }'
```

**Success Response (200 OK):**
```json
{
  "_id": "60d21b4667d0d8992e610c93",
  "status": "ignored",
  "statusHistory": [
    {
      "status": "ignored",
      "changedAt": 1772248000000,
      "changedBy": "system",
      "note": "False positive - data was actually consistent"
    }
  ],
  "updatedAt": 1772248000000
}
```

---

## Common Error Responses

### Validation Error (400)

```json
{
  "error": "Field validation failed",
  "code": "VALIDATION_ERROR",
  "details": {
    "field": "alias",
    "value": "Invalid Alias!",
    "reason": "Alias can only contain lowercase letters, numbers, dash, and underscore"
  }
}
```

### Not Found (404)

```json
{
  "error": "Resource not found"
}
```

### Conflict (409)

```json
{
  "error": "alias already exists",
  "code": "ALIAS_EXISTS"
}
```

### Range Not Satisfiable (416)

```json
{
  "error": "Range Not Satisfiable",
  "code": "INVALID_RANGE"
}
```

### Internal Server Error (500)

```json
{
  "error": "Block file not found: /storage/blocks/d9/8d9fe...",
  "code": "FILE_MISSING"
}
```
