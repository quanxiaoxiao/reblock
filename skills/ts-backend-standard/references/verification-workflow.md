# Verification Workflow

Always verify through repository scripts when they exist.

## Command Order

Default verification sequence:

1. `npm run typecheck`
2. `npm run lint`
3. `npm run test`
4. `npm run test:hurl` when route, API contract, or error-path behavior changed

Do not replace these with raw tool invocations unless the repository does not provide scripts.

## When To Run API Tests

Run `npm run test:hurl` or the repository's equivalent when changes touch:

- route definitions
- request validation
- response shape
- HTTP status codes
- middleware behavior
- error handling paths

If the repository has a different API test harness, use that script instead of forcing Hurl.

## Failure Handling

When verification fails:

- report the first concrete failing command
- summarize root cause, not just raw logs
- fix with minimal compliant changes
- re-run the failed command before re-running the full sequence when appropriate

## Final Reporting Contract

Return results in this order:

1. `Summary`
2. `Changes`
3. `Verification`
4. `Risks`

Each verification line should clearly show:

- command
- pass or fail
- short note when relevant

## Portability Rule

Use `package.json` scripts as the source of truth.

If a script is missing:

- say it was unavailable
- do not invent a project-standard command unless the user explicitly asks for one
