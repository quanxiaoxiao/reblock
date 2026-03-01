# Error Fix Workflow Rule

This rule defines the workflow for fixing 500 errors in the Reblock service.

## Overview

When a 500 error occurs, use this workflow to:
1. Identify and understand the error
2. Fix the underlying issue
3. Verify the fix with tests
4. Mark the error as resolved

## Workflow Steps

### Step 1: Detect Error

- Server returns 500 error
- Error is automatically logged to LogService with category `RUNTIME_ERROR`
- Error includes: timestamp, path, method, error message, stack trace, request details

### Step 2: Query Error

```bash
# Get list of unresolved errors
curl "http://localhost:4362/errors?days=7&status=open"
```

### Step 3: Analyze Error

```bash
# Get detailed error information in AI-friendly format
curl "http://localhost:4362/errors/{error_id}/export"
```

The export includes:
- Error summary and message
- Full stack trace
- Reproduction steps (method, path, params, body)
- Suggested action

### Step 4: Run Baseline Tests

Before making any changes, establish a baseline:

```bash
# Run unit tests
npm run test

# Run integration tests
npm run test:hurl
```

Both tests must pass before proceeding to fix.

### Step 5: Fix the Code

1. Review the error details and stack trace
2. Identify the root cause
3. Make necessary code changes
4. Do not modify test files to make them pass - fix the actual code

### Step 6: Verify Fix

```bash
# Run unit tests
npm run test

# Run integration tests
npm run test:hurl
```

Both tests must pass. If tests fail, the fix is incomplete.

### Step 7: Mark as Resolved

```bash
curl -X POST "http://localhost:4362/errors/{error_id}/resolve" \
  -H "Content-Type: application/json" \
  -d '{"resolution": "Fixed by [description of fix]"}'
```

---

## Error Export Format

```json
{
  "errorId": "69a3ae38c96536b31e708f3e",
  "summary": "Cast to ObjectId failed for value",
  "reproduction": {
    "method": "GET",
    "path": "/entries/restricted-1772333146",
    "timestamp": "2026-03-01T10:00:00.000Z",
    "headers": {
      "user-agent": "curl/8.7.1"
    },
    "query": {},
    "params": {
      "id": "restricted-1772333146"
    },
    "body": null
  },
  "stackTrace": "CastError: Cast to ObjectId failed for value...",
  "suggestedAction": "Update getById to support alias query",
  "status": "open"
}
```

---

## Testing Requirements

### Before Fix (Baseline)

```bash
npm run test    # Must pass
npm run test:hurl  # Must pass
```

### After Fix

```bash
npm run test    # Must pass
npm run test:hurl  # Must pass
```

If either test fails, the fix is incomplete. Do not mark error as resolved until both tests pass.

---

## Status Flow

```
open → acknowledged → resolved
  │          │
  │          └─► Developer is investigating
  │
  └─► New error, not yet handled
```

- Use `acknowledge` when you start investigating but haven't fixed yet
- Use `resolve` when the fix is complete and tests pass

---

## Common Error Patterns

### CastError (ObjectId)

**Error**: `Cast to ObjectId failed for value "xxx"`

**Fix**: Check if the endpoint should support non-ObjectId identifiers (like aliases)

**Example**: `/entries/:id` should accept both ObjectId and alias

---

## Example Fix Process

### 1. Query error
```bash
curl "http://localhost:4362/errors?days=1" | jq '.errors[0]'
```

### 2. Get export
```bash
curl "http://localhost:4362/errors/69a3ae38c96536b31e708f3e/export"
```

Output:
```json
{
  "errorId": "69a3ae38c96536b31e708f3e",
  "summary": "Cast to ObjectId failed for value \"restricted-1772333146\"",
  "reproduction": {
    "method": "GET",
    "path": "/entries/restricted-1772333146"
  },
  "stackTrace": "CastError: Cast to ObjectId failed..."
}
```

### 3. Fix code

Modify `entryService.getById()` to check if id is valid ObjectId:

```typescript
async getById(id: string): Promise<IEntry | null> {
  const isValidObjectId = mongoose.isValidObjectId(id);
  const query = isValidObjectId
    ? { _id: id, isInvalid: { $ne: true } }
    : { alias: id, isInvalid: { $ne: true } };
  return Entry.findOne(query);
}
```

### 4. Run tests
```bash
npm run test && npm run test:hurl
```

### 5. Mark resolved
```bash
curl -X POST "http://localhost:4362/errors/69a3ae38c96536b31e708f3e/resolve" \
  -H "Content-Type: application/json" \
  -d '{"resolution": "Updated getById to support alias query"}'
```

---

## CLI Scripts

As an alternative to curl commands, you can use the npm scripts:

### Fetch Errors

```bash
# Fetch last 7 days open errors
npm run errors:fetch

# Fetch last 30 days
npm run errors:fetch -- --days 30

# Fetch resolved errors
npm run errors:fetch -- --status resolved

# AI-friendly export format
npm run errors:fetch -- --export

# JSON output
npm run errors:fetch -- --json

# Custom server
npm run errors:fetch -- --server 192.168.1.100 --port 4362
```

### Resolve Error

```bash
npm run errors:resolve -- --id <error_id> --resolution "Fixed by <description>"
```

### errors:fetch Options

| Option | Default | Description |
|--------|---------|-------------|
| `--days` | 7 | Time range in days |
| `--status` | open | Status filter: open, acknowledged, resolved, all |
| `--limit` | 100 | Maximum results |
| `--offset` | 0 | Pagination offset |
| `--json` | false | JSON output |
| `--export` | false | AI-friendly export format |
| `--server` | localhost | Server hostname |
| `--port` | 4362 | Server port |

### errors:resolve Options

| Option | Required | Description |
|--------|----------|-------------|
| `--id` | Yes | Error ID to resolve |
| `--resolution` | Yes | Resolution description |
| `--server` | No | Server hostname |
| `--port` | No | Server port |

---

## Integration with OpenCode

When using OpenCode to fix errors:

1. Ask the AI to run `npm run errors:fetch -- --export`
2. Provide the error details to the AI
3. Let the AI analyze and fix the code
4. Ask the AI to verify with `npm run test && npm run test:hurl`
5. Ask the AI to mark resolved with `npm run errors:resolve -- --id <error_id> --resolution "..."`

## Important Notes

1. **Both tests must pass**: Don't mark as resolved unless `npm run test` and `npm run test:hurl` pass
2. **Provide clear resolution**: Explain what was fixed in the resolution description
3. **Check server connectivity**: Ensure the server is running and accessible
4. **Use --export for AI**: The export format includes all details needed for AI analysis

---

## Implementation Checklist

- [ ] Run baseline tests before making changes
- [ ] Analyze error details and stack trace
- [ ] Identify root cause, not just symptoms
- [ ] Make minimal, targeted fixes
- [ ] Run `npm run test` - must pass
- [ ] Run `npm run test:hurl` - must pass
- [ ] Provide clear resolution description
- [ ] Mark error as resolved via API
- [ ] Verify error is filtered from open queries
