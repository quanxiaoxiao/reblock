# API Examples

This document provides complete request/response examples for all Reblock API endpoints.

---

## Table of Contents

1. [Entry API Examples](#entry-api-examples)
2. [Resource API Examples](#resource-api-examples)
3. [Block API Examples](#block-api-examples)
4. [Upload API Examples](#upload-api-examples)
5. [Error API Examples](#error-api-examples)

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

## Error API Examples

### Acknowledge an Issue

**Request:**
```bash
curl -X POST "http://localhost:3000/errors/60d21b4667d0d8992e610c93/acknowledge" \
  -H "Content-Type: application/json" \
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
