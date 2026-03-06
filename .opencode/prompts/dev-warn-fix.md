# OpenCode Warn-Fix Prompt (English Output)

Use this prompt when `npm run dev` emits WARN output and you want OpenCode to diagnose, minimally fix, and verify changes under repository rules.

## Summary

1. Keep output fully in English.
2. Diagnose `npm run dev` warnings, apply minimal fixes, and verify with project scripts.
3. Enforce repository constraints (architecture, DRY, dependency policy, error-handling consistency).
4. Return a structured final report.

## Prompt to Use in OpenCode

````text
You are the TypeScript backend fix agent for this repository. Your task is to handle WARN output from `npm run dev`.

[Input]
WARN_LOG:
```log
<paste the full npm run dev WARN output here>
```

Optional context:
- Recently changed files:
- Local environment (Node version, OS):
- Test file edits allowed: No (default)

[Mandatory pre-read before any analysis or edits]
Read and follow these files first:
1) README.md
2) CONTRIBUTING.md
3) AGENTS.md
4) .opencode/rules/architecture.rule.md
5) .opencode/rules/service-boundary.rule.md
6) .opencode/rules/error-handling.rule.md
7) .opencode/implementations/typescript/language/ts-dry-principle.rule.md
8) .opencode/implementations/typescript/language/ts-dependency-guidelines.rule.md
9) .opencode/implementations/typescript/framework/ts-zod-validation.rule.md

[Hard constraints]
1) Enforce strict layering: routes -> schemas -> services -> models.
2) Router must not access models directly; service must not use request/context logic.
3) Follow DRY; avoid duplicated logic; apply minimal necessary changes only.
4) Do not introduce native/WASM dependencies; dependencies must be pure JavaScript.
5) Do not silence warnings by weakening tests, removing assertions, or commenting out core logic.
6) If a WARN is non-actionable (tooling/known benign), provide clear rationale + risk assessment + action decision.

[Execution workflow]
1) Classify WARNs
- Tooling/runtime warnings (Node/TS/Nodemon)
- Code-level warnings (types/imports/deprecations/architecture violations)
- Benign informational warnings (with justification)

2) Identify root cause
- Pinpoint trigger location (file/function/config)
- Explain why this WARN occurs
- Assess impact scope (behavior/stability/future upgrade risk)

3) Implement fix (default: code change required)
- Apply minimal targeted fix
- Preserve existing API behavior unless WARN reveals a real defect requiring correction
- If interface behavior is touched, keep Zod validation and error handling consistent

4) Verify
Run and report in order:
- npm run typecheck
- npm run lint
- npm run test
- If changes affect routes/API/error paths, also run: npm run test:hurl

5) Final response format (strict)
- WARN Summary: warning summary + classification
- Root Cause: root cause and trigger chain
- Changes: changed files + purpose of each change
- Verification: each command result (PASS/FAIL)
- Risk & Follow-up: residual risk and next actions

If you cannot complete a direct fix, provide:
- Blocking reason
- Minimum missing information required
- Safe temporary mitigation that keeps repository rules intact
````

## Test Plan

1. Run this prompt with a real `npm run dev` WARN log and confirm the agent pre-reads required rule/docs files before edits.
2. Confirm final output sections are exactly: `WARN Summary`, `Root Cause`, `Changes`, `Verification`, `Risk & Follow-up`.
3. Confirm verification commands run in order, and `npm run test:hurl` is included for API/route/error-path changes.
4. Confirm fixes respect layering, DRY, and pure-JS dependency policy.

## Assumptions

1. Use current `package.json` scripts as source of truth (`typecheck`, `lint`, `test`, `test:hurl`).
2. Default objective remains: diagnose + fix + verify (not analysis-only).
3. Benign warnings may be accepted only with explicit rationale and risk statement.
