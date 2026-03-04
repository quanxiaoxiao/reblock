# Error Handling Rule

This document defines the error handling patterns for the Reblock service.

---

## HTTP Status Codes

| Status Code | Usage                          | Description                                           |
|-------------|--------------------------------|-------------------------------------------------------|
| 200         | Success                        | GET/PUT successful                                    |
| 201         | Created                        | POST resource created                                 |
| 204         | No Content                     | DELETE successful                                     |
| 206         | Partial Content                | Range request successful (download)                   |
| 400         | Client Error                   | Validation error, bad request (includes file size, MIME type) |
| 401         | Unauthorized                   | Invalid or missing authentication token               |
| 403         | Forbidden                      | Read-only, access denied                              |
| 404         | Not Found                      | Resource not found                                    |
| 409         | Conflict                       | Duplicate alias, constraint violation                 |
| 416         | Range Not Satisfiable          | Invalid byte range for download                       |
| 500         | Server Error                   | Internal error                                        |

---

## Error Response Format

### Standard Error

```json
{
  "error": "Human-readable message",
  "code": "PROGRAMMATIC_ERROR_CODE"
}
```

### Validation Error

```json
{
  "error": "Validation error",
  "details": [
    {
      "field": "name",
      "message": "String must contain at least 1 character"
    },
    {
      "field": "uploadConfig.maxFileSize",
      "message": "Number must be greater than 0"
    }
  ]
}
```

---

## Error Codes

### Service Error Codes

| Code                | HTTP Status | Description                              |
|---------------------|-------------|------------------------------------------|
| NOT_FOUND           | 404         | Resource not found                       |
| BLOCK_NOT_FOUND     | 404         | Block not found or invalid               |
| FILE_MISSING        | 404         | Physical file missing from storage       |
| INVALID_STATE       | 400         | Resource in invalid state               |
| RANGE_INVALID       | 416         | Invalid byte range request               |
| ALREADY_EXISTS      | 409         | Resource already exists (alias, etc.)    |
| CONSTRAINT_VIOLATION| 409         | Database constraint violated             |
| FILE_TOO_LARGE      | 413         | File exceeds max size                    |
| INVALID_MIME_TYPE   | 415         | MIME type not allowed                     |
| READ_ONLY           | 403         | Cannot modify read-only resource         |
| UNAUTHORIZED        | 401         | Invalid or missing authentication token  |

---

## Error Response Examples

### Not Found (404)

```bash
curl -X GET "http://localhost:3000/resources/60d21b4667d0d8992e610c99"

# Response:
HTTP/1.1 404 Not Found
Content-Type: application/json

{
  "error": "Resource not found",
  "code": "NOT_FOUND"
}
```

### Conflict - Alias Exists (409)

```bash
curl -X POST "http://localhost:3000/entries" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Another Entry",
    "alias": "my-docs"
  }'

# Response:
HTTP/1.1 409 Conflict
Content-Type: application/json

{
  "error": "alias already exists",
  "code": "ALREADY_EXISTS"
}
```

### Validation Error (400)

```bash
curl -X POST "http://localhost:3000/entries" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "",
    "alias": "invalid alias!"
  }'

# Response:
HTTP/1.1 400 Bad Request
Content-Type: application/json

{
  "error": "Validation error",
  "details": [
    {
      "field": "name",
      "message": "String must contain at least 1 character"
    },
    {
      "field": "alias",
      "message": "Alias can only contain lowercase letters, numbers, dash, and underscore"
    }
  ]
}
```

### File Too Large (413)

```bash
curl -X POST "http://localhost:3000/upload/my-docs" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @[large_file_path]

# Response:
HTTP/1.1 413 Payload Too Large
Content-Type: application/json

{
  "error": "File too large",
  "code": "FILE_TOO_LARGE"
}
```

### Invalid MIME Type (415)

```bash
curl -X POST "http://localhost:3000/upload/my-docs" \
  -H "Content-Type: application/exe" \
  --data-binary @[executable_file_path]

# Response:
HTTP/1.1 415 Unsupported Media Type
Content-Type: application/json

{
  "error": "File type not allowed",
  "code": "INVALID_MIME_TYPE"
}
```

### Read-only Entry (403)

```bash
curl -X POST "http://localhost:3000/upload/read-only-entry" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @[file_content_path]

# Response:
HTTP/1.1 403 Forbidden
Content-Type: application/json

{
  "error": "Entry is read-only",
  "code": "READ_ONLY"
}
```

### Range Not Satisfiable (416)

```bash
curl -X GET "http://localhost:3000/resources/60d21b4667d0d8992e610c87/download" \
  -H "Range: bytes=10000-20000"

# Response:
HTTP/1.1 416 Range Not Satisfiable
Content-Range: bytes */1024000
Content-Type: application/json

{
  "error": "Range Not Satisfiable",
  "code": "RANGE_INVALID"
}
```

### Internal Server Error (500)

```bash
curl -X GET "http://localhost:3000/resources/60d21b4667d0d8992e610c87/download"

# Response:
HTTP/1.1 500 Internal Server Error
Content-Type: application/json

{
  "error": "Block file not found: /storage/blocks/d9/8d9fe...",
  "code": "FILE_MISSING"
}
```

---

## Error Handling by Service

### BlockService

- Returns null for not found (router handles 404)
- Soft delete returns null if block doesn't exist

### EntryService

- Checks alias uniqueness on create/update
- Throws conflict error if duplicate alias
- Returns null for not found

### ResourceService

- Validates block and entry existence on create
- Validates range on download
- Throws not found if resource/block missing
- Updates lastAccessedAt on download

### UploadService

- Validates entry exists and is not read-only
- Validates file size against upload config
- Validates MIME type against upload config
- Throws appropriate errors for each validation

---

## Client Error Handling

### Error Handling Flow

1. Check response status code
2. Parse error JSON if available
3. Handle based on error code
4. Provide user-friendly message

### Generic Client Example (Language-Independent Approach)

CLIENT PROCEDURE uploadFile(alias, file):
    INPUT: alias (string), file (binary/object)
    OUTPUT: upload response or appropriate error
    
    SEND HTTP POST REQUEST to "/upload/" + alias with file content
    STORE response
    
    IF response status is 2xx:
        PARSE response as JSON
        RETURN parsed response
    END IF
    
    PARSE error response as JSON
    RESPONSE STATUS CODE determines error handling:
        CASE 413: 
            RAISE "File too large" error with details from response
        CASE 415: 
            RAISE "Invalid file type" error with details from response
        CASE 403: 
            RAISE "Entry is read-only" error with details from response
        CASE 404: 
            RAISE "Entry not found" error with details from response
        DEFAULT: 
            RAISE "Upload failed" error with details from response
    END CONDITIONAL
END PROCEDURE

---

## Implementation Checklist

When implementing error handling, ensure:

- [ ] HTTP status codes are appropriate for error type
- [ ] Error codes are included for programmatic handling
- [ ] Global error handler catches unhandled errors
- [ ] Validation errors are properly formatted with field details
- [ ] Error messages are user-friendly
- [ ] Stack traces are logged (not exposed to client)
- [ ] Critical errors are logged to LogService
- [ ] 404 returns null from service (router converts to response)
- [ ] All error responses follow the standard format
- [ ] No hardcoded generic messages like "Internal Server Error" returned directly from route handlers (use centralized handler instead)
- [ ] All errors flow through centralized error handler when appropriate
