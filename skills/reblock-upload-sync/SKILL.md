---
name: reblock-upload-sync
description: Plan and execute incremental local-file upload synchronization to Reblock entries. Use when users ask to sync a directory to an entry alias, upload only changed files, run dry-run plans, or verify post-sync integrity with hash/linkCount checks.
---

# Reblock Upload Sync

Synchronize local files to an entry alias with safe, incremental, and verifiable steps.

## Use This Workflow

1. Prefer the high-level tool `sync_directories_to_entries`.
2. Sync one or multiple directories in one request.
3. Auto-create entries when missing unless explicitly disabled.
4. Keep remote-only files by default (`remotePolicy=keep`).
5. Produce JSON and Markdown reports for each directory plus batch summary.

## Standard Execution Order

1. Run `sync_directories_to_entries` with:
- `directories[]`
- `createEntryIfMissing=true`
- `remotePolicy=keep`
- `reportDir=analysis_output`
2. Return per-directory totals:
- new files
- changed files
- unchanged files
- rejected files
3. Return apply totals:
- requested uploads
- uploaded
- failed
4. Return verify totals:
- missing remote
- missing sha
- duplicate names
5. If any directory fails, continue others and report failed directories clearly.

## Fallback (Low-Level Tools)

Use low-level tools only when high-level tool is unavailable:

1. `build_local_manifest`
2. `plan_upload_sync`
3. `apply_upload_sync`
4. `verify_upload_sync`

## Verification Rules

1. Compare local files against remote by `name + sha256`.
2. Confirm no unexpected status errors (`4xx/5xx`) in upload batch.
3. Track missing SHA and duplicate names in verification output.
4. Recommend `logs:analyze`/doctor path when data inconsistency is suspected.

## Fallback Commands

Use shell/API fallback only when MCP tool is unavailable:

```bash
shasum -a 256 <file>
curl -X POST "http://127.0.0.1:4362/upload/<alias>?name=<filename>" --data-binary "@<file>"
npm run logs:analyze -- --days 1
```

## Output Contract

Always return:

1. `PlanSummary`: totals and risk flags
2. `ApplySummary`: uploaded/skipped/failed counts
3. `VerifySummary`: passed checks and mismatches
4. `ReportFiles`: per-directory JSON/Markdown + batch JSON summary
5. `NextAction`: retry failed directories, rollback, or done

Default to safety over throughput.
