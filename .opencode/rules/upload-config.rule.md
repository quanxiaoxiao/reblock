# Rule: Entry Upload Configuration

## Overview

Each Entry can have an optional `uploadConfig` to control file uploads:
- **maxFileSize**: Maximum allowed file size in bytes
- **allowedMimeTypes**: List of allowed MIME types (supports wildcards like `image/*`)
- **readOnly**: When true, prevents any uploads to the entry

## Data Model

### Entry Schema Extension

```typescript
interface IUploadConfig {
  maxFileSize?: number;        // Maximum file size in bytes
  allowedMimeTypes?: string[]; // Allowed MIME types (supports wildcards)
  readOnly?: boolean;         // Prevents uploads when true
}

interface IEntry {
  // ... other fields
  uploadConfig?: IUploadConfig;
}
```

## Upload Validation Flow

When a file is uploaded to an entry:

```
1. Validate Entry exists and is not soft-deleted
   └─► Check readOnly flag
       └─► If true, return 403 "Entry is read-only"

2. Compute file SHA256

3. Get file size
   └─► Validate against maxFileSize
       └─► If exceeded, return 400 "File size exceeds limit"

4. Detect actual MIME type using file-type library
   └─► Validates against allowedMimeTypes
       └─► If not allowed, return 400 "MIME type not allowed"

5. Continue with normal upload flow (deduplication, storage, etc.)
```

## MIME Type Matching

Supports wildcard patterns:
- `image/*` matches `image/png`, `image/jpeg`, `image/gif`, etc.
- `video/*` matches all video types
- `application/*` matches all application types
- Exact match: `application/pdf`

## API Examples

### Create Entry with Upload Config

```bash
curl -X POST http://localhost:3000/entries \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Images Only",
    "alias": "images",
    "uploadConfig": {
      "maxFileSize": 10485760,
      "allowedMimeTypes": ["image/*"],
      "readOnly": false
    }
  }'
```

Response:
```json
{
  "_id": "...",
  "name": "Images Only",
  "alias": "images",
  "uploadConfig": {
    "maxFileSize": 10485760,
    "allowedMimeTypes": ["image/*"],
    "readOnly": false
  }
}
```

### Update Entry to Read-Only Mode

```bash
curl -X PUT http://localhost:3000/entries/:id \
  -H "Content-Type: application/json" \
  -d '{
    "uploadConfig": {
      "readOnly": true
    }
  }'
```

### Upload to Read-Only Entry (Expected Failure)

```bash
curl -X POST http://localhost:3000/upload/images \
  -H "Content-Type: image/png" \
  --data-binary @photo.png
```

Response (403):
```json
{
  "error": "Entry is read-only"
}
```

### Upload with Disallowed MIME Type (Expected Failure)

```bash
# Entry configured with allowedMimeTypes: ["image/*"]
curl -X POST http://localhost:3000/upload/images \
  -H "Content-Type: application/pdf" \
  --data-binary @document.pdf
```

Response (400):
```json
{
  "error": "MIME type not allowed: application/pdf, allowed: image/*"
}
```

## Error Responses

| Scenario | Status Code | Error Message |
|----------|-------------|---------------|
| Entry not found | 404 | "Entry not found" |
| Entry is read-only | 403 | "Entry is read-only" |
| File size exceeds limit | 400 | "File size exceeds limit: {max} bytes" |
| MIME type not allowed | 400 | "MIME type not allowed: {detected}, allowed: {list}" |

## Testing

See `tests/hurl/upload/config.hurl` for integration tests covering:
- Creating entry with upload config
- Uploading files with allowed MIME types
- Updating entry to read-only mode
- Rejecting uploads to read-only entries
