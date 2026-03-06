# Reblock MCP Server (Phase 1 + Phase 2)

This server exposes Reblock HTTP/error tools and upload sync tools over MCP stdio.

## Start

```bash
npm run mcp:serve
```

## Smoke Test

```bash
npm run mcp:smoke
```

With report output:

```bash
npm run -s mcp:smoke -- --report-file analysis_output/mcp-smoke.json
```

The smoke test validates:
- MCP `initialize` and `tools/list`
- `build_local_manifest` success on local fixture files
- `plan_upload_sync` graceful failure path when API is unreachable
- `sync_directories_to_entries` explicit rejection of unsupported `remotePolicy=prune`

## E2E Sync Test

```bash
npm run mcp:e2e-sync
```

Options:
- `--base-url http://127.0.0.1:4382`
- `--skip-build`
- `--keep-files`
- `--report-file analysis_output/mcp-e2e-sync.json`
- `--report-dir analysis_output`
- `--max-duplicate-names 0`
- `--max-missing-sha 0`
- `--max-missing-remote 0`

Behavior:
- Uses two temporary fixture directories in one batch run
- Runs high-level MCP flow: `sync_directories_to_entries`
- Verifies per-folder JSON/Markdown reports and batch JSON report exist and are non-empty
- Deletes created test entries on exit
- Starts local `dist/server.js` automatically if target API is not already healthy

## Implemented Tools

1. `run_hurl_suite`
- Executes `sh ./test-hurl.sh`
- Main args: `hurlEnv`, `testPort`, `apiToken`, `serverLog`

2. `run_hurl_case`
- Executes a single hurl file with standard variables
- Main args: `hurlFile`, `baseUrl`, `apiToken`, `hurlEnv`

3. `fetch_open_errors`
- Calls `GET /errors` directly
- Main args: `days`, `status`, `limit`, `offset`, `requestId`

4. `generate_error_repro`
- Executes `node scripts/error-handling/errors-repro.mjs`
- Main args: `errorId`, `runImmediately`, `output`, `expectStatus`

5. `resolve_error`
- Executes `node scripts/error-handling/errors-resolve.mjs`
- Main args: `errorId`, `resolution`

6. `build_local_manifest`
- Scans local files and computes `sha256` for each file
- Main args: `sourceDir`, `glob`, `outputFile`

7. `plan_upload_sync`
- Compares manifest with remote `GET /resources?entryAlias=...`
- Main args: `entryAlias`, `manifestFile`, `outputFile`, `baseUrl`, `dryRun`

8. `apply_upload_sync`
- Executes upload actions from a generated plan
- Main args: `planFile`, `confirm=true`, `concurrency`, `baseUrl`

9. `verify_upload_sync`
- Verifies remote state after sync
- Main args: `entryAlias`, `sampleSize`, `manifestFile`, `baseUrl`

10. `sync_directories_to_entries`
- High-level multi-folder sync workflow (entry ensure -> build -> plan -> apply -> verify)
- Main args: `directories[]`, `createEntryIfMissing`, `remotePolicy`, `concurrency`, `dryRun`, `reportDir`

Example:

```json
{
  "tool": "sync_directories_to_entries",
  "args": {
    "directories": [
      { "sourceDir": "imgs" },
      { "sourceDir": "docs/assets", "entryAlias": "assets" }
    ],
    "createEntryIfMissing": true,
    "remotePolicy": "keep",
    "reportDir": "analysis_output"
  }
}
```

## Expected Env

The server reads `.env` automatically and reuses existing script conventions:

- `API_BASE_URL` or `PORT`/`SERVER_PORT`
- `API_AUTH_TOKEN` (or `ERRORS_API_TOKEN` fallback)

## Notes

- Output is returned as structured JSON in `structuredContent`.
- Command stdout/stderr are included as `stdoutTail` / `stderrTail` (tail only).
- Sync write action is gated by `confirm=true` in `apply_upload_sync`.
- `sync_directories_to_entries` may create entries and perform uploads when `dryRun=false`.

## Client Config Example

Use this command in your MCP client:

```json
{
  "command": "npm",
  "args": ["run", "mcp:serve"],
  "cwd": "/Users/huzhedong/temp/resources"
}
```
