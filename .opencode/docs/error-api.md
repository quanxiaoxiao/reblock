# Error API (500 Error Management)

## Overview

Error API provides 500 error query and management, supporting AI-assisted debugging and error fix workflow.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Error Management Flow                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. Server Error (500)                                                       │
│         │                                                                    │
│         ▼                                                                    │
│  2. errorHandler Middleware                                                 │
│         │                                                                    │
│         ├──→ LogService.logIssue()                                           │
│         │         │                                                           │
│         │         ▼                                                           │
│         │    MongoDB (LogEntry with RUNTIME_ERROR category)                 │
│         │         │                                                           │
│         │         ▼                                                           │
│         │    JSON Lines file (storage/_logs/issues/YYYY-MM-DD.jsonl)        │
│         │                                                                    │
│         ▼                                                                    │
│  3. GET /errors → Query from MongoDB                                         │
│         │                                                                    │
│         ▼                                                                    │
│  4. AI analyzes error → Fix code                                             │
│         │                                                                    │
│         ▼                                                                    │
│  5. POST /errors/:id/resolve → Mark as resolved                             │
│         │                                                                    │
│         ▼                                                                    │
│  6. Future queries automatically filter resolved errors                     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Authentication

All `/errors` endpoints require a valid API token. Token is provided via one of:
- `x-errors-token` header
- `x-migration-token` header
- `Authorization: Bearer <token>` header

Token comparison uses `crypto.timingSafeEqual()` to prevent timing attacks.

If no token is configured on the server (`ERRORS_API_TOKEN` and `MIGRATION_API_TOKEN` are both unset),
all requests to `/errors` endpoints are rejected with **403 Forbidden**.

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/errors` | Query error list |
| `GET` | `/errors/:id` | Get error detail |
| `GET` | `/errors/:id/export` | AI-friendly error export |
| `POST` | `/errors/:id/resolve` | Mark error as resolved |
| `POST` | `/errors/:id/acknowledge` | Acknowledge error |

---

## Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `days` | number | 7 | Time range in days |
| `status` | string | open | Filter: `open` \| `acknowledged` \| `resolved` \| `all` |
| `includeResolved` | boolean | false | Include resolved errors in results |
| `limit` | number | 100 | Maximum results to return |
| `offset` | number | 0 | Pagination offset |

---

## Response Schemas

### Error List Item

```json
{
  "_id": "69a3ae38c96536b31e708f3e",
  "timestamp": 1772334648359,
  "level": "ERROR",
  "category": "RUNTIME_ERROR",
  "status": "open",
  "details": {
    "errorId": "...",
    "path": "/entries/restricted-1772333146",
    "method": "GET",
    "errorMessage": "Cast to ObjectId failed...",
    "errorName": "CastError",
    "stack": "...",
    "clientIp": "127.0.0.1"
  },
  "suggestedAction": "Check server logs for detailed error information",
  "resolvedAt": 1772334700000,
  "resolution": "Fixed by adding alias support",
  "resolvedBy": "system"
}
```

### AI Export Format

```json
{
  "errorId": "69a3ae38c96536b31e708f3e",
  "summary": "Cast to ObjectId failed for value",
  "reproduction": {
    "method": "GET",
    "path": "/entries/restricted-1772333146",
    "timestamp": "2026-03-01T10:00:00.000Z",
    "headers": {
      "user-agent": "curl/8.7.1",
      "content-type": "application/json"
    },
    "query": {},
    "params": { "id": "restricted-1772333146" },
    "body": null
  },
  "stackTrace": "CastError: Cast to ObjectId failed...",
  "suggestedAction": "Update getById to support alias query",
  "status": "open",
  "resolvedAt": null,
  "resolution": null,
  "resolvedBy": null,
  "fixedVersion": null
}
```

---

## AI Debugging Workflow

### Step 1: Query Unresolved Errors

```bash
curl "http://localhost:4362/errors?days=7&status=open"
```

### Step 2: Get AI-Friendly Export

```bash
curl "http://localhost:4362/errors/{error_id}/export"
```

### Step 3: Analyze and Fix

Review the export to understand:
- Error message and stack trace
- Request reproduction details (method, path, params, body)
- Suggested action

### Step 4: Run Tests

```bash
npm run test
npm run test:hurl
```

### Step 5: Mark as Resolved

```bash
curl -X POST "http://localhost:4362/errors/{error_id}/resolve" \
  -H "Content-Type: application/json" \
  -d '{"resolution": "Fixed by adding alias support to getById method"}'
```

---

## Status Flow

```
┌─────────┐     ┌───────────────┐     ┌───────────┐
│  open   │ ──► │ acknowledged  │ ──► │ resolved  │
└─────────┘     └───────────────┘     └───────────┘
     │                 │                    │
     │                 │                    │
     └─────────────────┴────────────────────┘
              (can also go directly to resolved)
```

- **open**: Newly detected error, not yet handled
- **acknowledged**: Developer is aware, investigating
- **resolved**: Issue has been fixed

---

## Filtering Behavior

By default, queries exclude resolved errors:

```bash
# Returns only open errors (default)
GET /errors?days=7

# Returns open and acknowledged
GET /errors?days=7&status=all

# Include resolved in results
GET /errors?days=7&includeResolved=true
```

---

## Hurl Tests

Run error API tests:

```bash
npm run test:hurl
```

### Test Files

| File | Description |
|------|-------------|
| `tests/hurl/errors/resolve.hurl` | Test resolve workflow |
| `tests/hurl/errors/acknowledge.hurl` | Test acknowledge workflow |

---

## Error Logging Details

The following information is automatically captured for each 500 error:

| Field | Description |
|-------|-------------|
| `errorId` | Unique identifier for this error instance |
| `timestamp` | When the error occurred |
| `path` | Request path |
| `method` | HTTP method |
| `clientIp` | Client IP address |
| `errorMessage` | Error message |
| `errorName` | Error type (e.g., CastError, TypeError) |
| `stack` | Full stack trace |
| `query` | Query parameters |
| `params` | Path parameters |
| `headers` | Request headers (sanitized) |
| `body` | Request body (sanitized) |

### Sanitization Rules

- **Headers**: `authorization`, `cookie`, `x-api-key` are redacted
- **Body**: Fields containing `password`, `token`, `secret`, `key` are redacted

---

## Integration Points

### Automatic Error Capture

Errors are automatically logged by the `errorHandler` middleware in `src/app.ts`:

```typescript
app.use('*', errorHandler);
```

### Manual Error Logging

Services can also log errors manually:

```typescript
await logService.logIssue({
  level: LogLevel.ERROR,
  category: LogCategory.RUNTIME_ERROR,
  details: {
    errorMessage: err.message,
    stack: err.stack,
    // ... other details
  },
  // ...
});
```

---

## Variables

test-hurl.sh provides the following variables:

| Variable | Format | Example |
|----------|--------|---------|
| `{{timestamp}}` | Unix timestamp | 1772334648 |
| `{{date}}` | YYYY-MM-DD | 2026-03-01 |
| `{{BASE_URL}}` | From env file | http://localhost:4362 |

---

## Best Practices

1. **Always run tests before marking as resolved**: `npm run test && npm run test:hurl`
2. **Provide clear resolution notes**: Explain what was fixed
3. **Check for duplicate errors**: Use the duplicate detection feature to avoid noise
4. **Export for AI analysis**: Use the export endpoint for better error understanding
5. **Keep status updated**: Move from open → acknowledged → resolved as appropriate
