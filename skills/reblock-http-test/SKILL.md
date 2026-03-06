---
name: reblock-http-test
description: Run and debug Reblock HTTP/API contract tests with Hurl and the /errors replay loop. Use when users ask to run API regression checks, verify upload/resource/entry behavior, reproduce runtime 500 errors, or summarize contract failures after code changes.
---

# Reblock HTTP Test

Execute API checks with deterministic steps and concise failure reporting.

## Use This Workflow

1. Prefer full-suite validation first.
2. Narrow to failing hurl case(s) for fast iteration.
3. Use `/errors` replay tools when status `500` appears.
4. Re-run the exact failing case after each fix.
5. Report only actionable failures and next fix target.

## Standard Execution Order

1. Run `run_hurl_suite` as baseline.
2. If failure exists, capture:
- failing file path
- status/assert mismatch
- endpoint and method
3. Re-run each failed file with `run_hurl_case`.
4. If `500` persists:
- run `fetch_open_errors`
- run `generate_error_repro` for latest related error
5. After fix, re-run failed case and then full suite.
6. Resolve runtime error by `resolve_error` only after verification pass.

## Fallback Commands

Use shell fallback only when MCP tool is unavailable:

```bash
npm run test:hurl
npm run errors:fetch -- --days 1 --status open
npm run errors:repro -- --run
```

## Output Contract

Always return:

1. `Result`: pass/fail + count
2. `Failures`: each with file, endpoint, expected, actual
3. `Repro`: generated hurl path or `none`
4. `NextAction`: exact next code/test step

Avoid broad prose. Keep output focused on fix sequencing.
