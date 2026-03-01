# Reblock E2E Test Script

A comprehensive end-to-end testing script for the Reblock storage service.

## Overview

This script performs complete integration testing of the Reblock system:

- Creates entries with upload configuration (read-only, MIME restrictions, file size limits)
- Generates random files (1KB-1MB) with controlled duplication rates
- Uploads files and verifies block deduplication
- Validates block linkCount correctness
- Tests deletion and 404 responses
- Re-uploads same files to verify linkCount recovery
- Runs health checks with Doctor script
- Analyzes logs for data integrity
- Cleans up test data

## Usage

```bash
# Run complete test suite (auto-cleanup)
npm run test:e2e

# Keep test data after completion
npm run test:e2e -- --keep-data

# Show detailed progress
npm run test:e2e -- --verbose

# Show help
npm run test:e2e -- --help
```

## Test Flow

1. **Create Entry** - Creates test entry with configuration
2. **Generate Files** - Creates 100-500 random files (1KB-1MB)
3. **Upload Files** - Uploads files with deduplication (20% duplicates, 3-5x each)
4. **Verify linkCount** - Validates block reference counting
5. **Delete Resources** - Deletes 50% of resources
6. **Verify 404** - Confirms deleted resources return 404
7. **Re-upload** - Re-uploads same files to test linkCount recovery
8. **Doctor Check** - Runs health diagnostics
9. **Log Analysis** - Verifies entry-related logs
10. **Cleanup** - Removes test data

## Configuration

The script reads configuration from `.env`:

```bash
# Server port (PORT takes precedence over SERVER_PORT)
PORT=3000
SERVER_PORT=4362

# MongoDB (for Doctor and log analysis)
MONGO_HOSTNAME=localhost
MONGO_PORT=27017
MONGO_DATABASE=reblock
```

## Test Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| Total Files | 100-500 | Random count each run |
| File Size | 1KB - 1MB | Random size per file |
| Duplicate Rate | 20% | Files uploaded 3-5 times |
| Delete Rate | 50% | Resources deleted for testing |

## Output

```
🧪 Reblock E2E Test Suite
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Step 1: Creating Entry with Configuration
──────────────────────────────────────────────────
✓ Entry created: e2e-test-1234567890
✓ ReadOnly rejection works correctly (403)

Step 2: Uploading Files
✓ Generated 340 unique files + 68 duplicates
✓ Upload completed: 476 resources created
✓ All 340 blocks have correct linkCount

Step 3: Deleting Resources (50%)
✓ Deleted 238 resources
✓ All 5 sampled deleted resources return 404

Step 4: Re-uploading Same Files
✓ Re-uploaded 20 files
✓ All 340 blocks have correct linkCount

Step 5: Running Doctor Check
✓ Doctor check passed (0 issues)

Step 6: Analyzing Logs
✓ Found 12 entry-related logs
✓ Found 340 block-related logs

Step 7: Cleanup
✓ Entry deleted successfully

Test Report
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Duration: 42.5s
Files Generated: 340 unique
Resources Created: 476
Entry: e2e-test-1234567890

✅ All tests passed!
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All tests passed |
| 1 | One or more tests failed |

## Data Preservation

Use `--keep-data` to preserve test entry and resources for manual inspection:

```bash
npm run test:e2e -- --keep-data
```

This is useful for:
- Debugging test failures
- Manual verification of uploaded files
- Checking database state
- Reviewing logs

## Dependencies

- Node.js 18+ (for native fetch)
- Running Reblock server
- MongoDB connection (for Doctor and logs)

## Troubleshooting

**Connection refused errors**
- Ensure Reblock server is running
- Check PORT configuration in .env

**Doctor check fails**
- MongoDB must be accessible
- Check MONGO_* configuration

**Upload timeout**
- Files up to 1MB may take time with many uploads
- Normal for 100+ file uploads

## See Also

- [Main README](../../README.md)
- [Doctor Script](../doctor.mjs) - Health diagnostics
- [Log Analysis](../logs-analyze.mjs) - Log inspection
