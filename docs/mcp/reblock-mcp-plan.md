# Reblock MCP + Skills Plan

## Goals

- Let the model reliably handle HTTP contract testing and 500-error replay first.
- Then expand to local file upload/incremental sync to reduce repeated uploads and manual checks.

## Why HTTP Testing First

- The project already has strong foundations: `test-hurl.sh`, `tests/hurl/**`, and `errors:*` scripts.
- Failure signals are explicit: HTTP status mismatches, assertion failures, reproducible requests.
- It is easier for models to reason about structured input/output and iterate quickly.

## Phased Rollout

1. Phase 1 (ready now)
- Tools: `run_hurl_suite`, `run_hurl_case`, `fetch_open_errors`, `generate_error_repro`, `resolve_error`
- Skill: `reblock-http-test`
- Output: failure summaries, minimal repro, before/after fix comparison
- Current status: MCP server implemented at `scripts/mcp/reblock-mcp-server.mjs`
- Validation: protocol/tool smoke check via `npm run mcp:smoke`
- CI: smoke check runs in `.github/workflows/ci.yml` and uploads `mcp-smoke-report` artifact

2. Phase 2 (enhancement)
- Tools: `build_local_manifest`, `plan_upload_sync`, `apply_upload_sync`, `verify_upload_sync`
- High-level tool: `sync_directories_to_entries` for generic folder batch sync
- Skill: `reblock-upload-sync`
- Output: dry-run sync plan, incremental upload, hash/linkCount verification report
- Current status: initial implementation added to `scripts/mcp/reblock-mcp-server.mjs`
- Validation: live flow test available via `npm run mcp:e2e-sync`
- CI: scheduled/manual E2E in `.github/workflows/mcp-e2e-sync.yml` with `mcp-e2e-sync-report` artifact

## MCP Tool Design Principles

- All tools return structured JSON (`ok`, `summary`, `artifacts`, `nextAction`).
- Default to `dryRun=true` to avoid unintended mutations.
- Require explicit `confirm=true` for write actions.
- Include traceability fields in test/sync results (case path, requestId, resourceId, blockId).

## Skill Trigger Guidance

1. `reblock-http-test`
- User intent: run API tests, reproduce 500s, regression-check upload/resource/entry behavior
- Typical prompts: "run hurl", "reproduce latest 500", "check API regressions for this change"

2. `reblock-upload-sync`
- User intent: sync a directory to an entry alias, upload only changed files, verify correctness
- Typical prompts: "sync this folder to alias", "upload incrementally", "verify uploads after sync"

## Direct Mapping to Current Repository

- HTTP test entry: `npm run test:hurl` (via `test-hurl.sh`)
- Error loop: `npm run errors:fetch` / `npm run errors:repro` / `npm run errors:resolve`
- Upload APIs: `POST /upload`, `POST /upload/:alias`
- Log analysis: `npm run logs:analyze`
