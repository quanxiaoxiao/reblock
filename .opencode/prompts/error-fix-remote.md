# Remote Error Fix Workflow

Use this prompt when fixing errors on a remote server using the CLI scripts.

## Overview

This workflow uses two CLI scripts to fetch errors from a remote server and mark them as resolved after fixing:

1. `npm run errors:fetch` - Fetch errors from remote server
2. `npm run errors:resolve` - Mark error as resolved

## Prerequisites

- Server address configured in `.env` file (SERVER_PORT, optional SERVER_HOST)
- Server must be running and accessible
- API endpoints `/errors` must be available

## Workflow Steps

### Step 1: Fetch Errors from Server

```bash
# Fetch last 7 days open errors
npm run errors:fetch

# Fetch last 30 days
npm run errors:fetch -- --days 30

# Fetch resolved errors
npm run errors:fetch -- --status resolved

# AI-friendly export format (includes full error details)
npm run errors:fetch -- --export

# JSON output
npm run errors:fetch -- --json

# Custom server
npm run errors:fetch -- --server 192.168.1.100 --port 4362
```

### Step 2: Analyze Error

From the output, identify the error ID you want to fix. The error ID is shown as `ID: <error_id>`.

For detailed analysis, you can also use:
```bash
# Export specific error in AI-friendly format
curl "http://localhost:4362/errors/{error_id}/export"
```

### Step 3: Run Baseline Tests

On the server (or locally if you have the code):

```bash
# Run unit tests
npm run test

# Run integration tests
npm run test:hurl
```

Both must pass before proceeding to fix.

### Step 4: Fix the Code

1. Review the error details from the export
2. Identify the root cause
3. Make the necessary code changes

### Step 5: Verify Fix

```bash
npm run test
npm run test:hurl
```

Both tests must pass. If either fails, the fix is incomplete.

### Step 6: Mark as Resolved

```bash
npm run errors:resolve -- --id <error_id> --resolution "Fixed by <description>"
```

Example:
```bash
npm run errors:resolve -- --id 69a3ae38c96536b31e708f3e --resolution "Fixed by adding alias support to getById method"
```

## Complete Example

```bash
# 1. Fetch errors
$ npm run errors:fetch -- --days 7 --export

=== AI-Friendly Error Exports ===
Total: 2

{
  "errorId": "69a3ae38c96536b31e708f3e",
  "summary": "Cast to ObjectId failed for value",
  "reproduction": {
    "method": "GET",
    "path": "/entries/restricted-1772333146"
  },
  "status": "open"
}
---

# 2. Run baseline tests
$ npm run test && npm run test:hurl

# 3. Fix the code...

# 4. Verify fix
$ npm run test && npm run test:hurl

# 5. Mark as resolved
$ npm run errors:resolve -- --id 69a3ae38c96536b31e708f3e --resolution "Updated getById to support alias query"

=== Error Resolved ===
{
  "success": true,
  "message": "Error 69a3ae38c96536b31e708f3e marked as resolved"
}
```

## Script Options

### errors:fetch

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

### errors:resolve

| Option | Required | Description |
|--------|----------|-------------|
| `--id` | Yes | Error ID to resolve |
| `--resolution` | Yes | Resolution description |
| `--server` | No | Server hostname |
| `--port` | No | Server port |

## Important Notes

1. **Both tests must pass**: Don't mark as resolved unless `npm run test` and `npm run test:hurl` pass
2. **Provide clear resolution**: Explain what was fixed in the resolution description
3. **Check server connectivity**: Ensure the server is running and accessible
4. **Use --export for AI**: The export format includes all details needed for AI analysis

## Integration with OpenCode

When using OpenCode to fix errors:

1. Ask the AI to run `npm run errors:fetch -- --export`
2. Provide the error details to the AI
3. Let the AI analyze and fix the code
4. Ask the AI to verify with `npm run test && npm run test:hurl`
5. Ask the AI to mark resolved with `npm run errors:resolve -- --id <error_id> --resolution "..."`
