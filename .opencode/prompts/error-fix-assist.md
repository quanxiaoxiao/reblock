# Error Fix Assist Prompt

> This prompt implements a simplified version of the workflow defined in
> [error-fix-workflow.rule.md](../rules/error-fix-workflow.rule.md).
>
> **Correspondence:**
> - Step 1 (Query) = Workflow Step 2 (Query) + Step 3 (Analyze)
> - Step 2 (Baseline) = Workflow Step 4 (Baseline Tests)
> - Step 3 (Fix) = Workflow Step 5 (Fix)
> - Step 4 (Verify) = Workflow Step 6 (Verify Fix)
> - Step 5 (Resolve) = Workflow Step 7 (Mark Resolved)
>
> This prompt focuses on practical commands for this specific project.
> For theoretical workflow details, see the rule document.

Use this prompt when the user wants to fix a 500 error.

## Configuration

Before running commands, set your API endpoint:

```bash
# To find your port, check:
# - .env file: PORT=xxxx
# - deploy.config.mjs: env.PORT
# - Or run: grep -E "PORT[:=]" .env deploy.config.mjs 2>/dev/null | head -5

API_HOST="localhost"
API_PORT="3000"  # Adjust to match your deployment
API_URL="http://${API_HOST}:${API_PORT}"
```

> All commands below use `${API_URL}` which expands to your configured endpoint.

## Quick CLI Alternative

For convenience, use the provided scripts instead of manual curl:

```bash
# Fetch errors
./scripts/get-errors.sh --days 7 --status open

# Resolve error
./scripts/resolve-error.sh --id <error_id> --resolution "Fixed by ..."
```

See [error-fix-workflow.rule.md](../rules/error-fix-workflow.rule.md) for full CLI options and documentation.

## Error Classification

Before fixing, classify errors per [error-fix-workflow.rule.md](../rules/error-fix-workflow.rule.md):

### System Errors (Requires Fix)
- Unexpected runtime errors
- Database operation failures
- File system errors
- **Action**: Analyze and fix

### Generated/Test Errors (Skip)
- Created by `POST /errors/test/create`
- Has `errorName: "TestError"`
- Suggested action contains "for testing purposes"
- **Action**: Skip - expected behavior

### Identification Function
```javascript
function isTestError(error) {
  const d = error.details || {};
  return d.errorName === 'TestError' ||
         d.path === '/errors/test/create' ||
         (error.suggestedAction || '').includes('testing purposes') ||
         (d.errorMessage || '').startsWith('Test error');
}
```

## Prompt Template

```
I need to fix a 500 error that occurred on the server.

Please follow the Error Fix Workflow:

1. First, query and classify errors:
   ```
   curl "${API_URL}/errors?days=7&status=open"
   ```
   
   **Filter out test errors** (do not fix these):
   - `errorName: "TestError"`
   - `path: "/errors/test/create"`
   - `suggestedAction` containing "testing purposes"
   
   **Record statistics**:
   - Total errors: X
   - Generated/Test errors (skip): Y
   - System errors (fix): Z

2. Get the error details using the export endpoint:
   ```
   curl "${API_URL}/errors/{error_id}/export"
   ```

3. Run the existing tests to establish a baseline:
   ```
   npm run test
   npm run test:hurl
   ```

4. Analyze the error and fix the code

5. Verify the fix by running tests again:
   ```
   npm run test
   npm run test:hurl
   ```

6. Mark the error as resolved:
   ```
   curl -X POST "${API_URL}/errors/{error_id}/resolve" \
     -H "Content-Type: application/json" \
     -d '{"resolution": "Brief description of the fix"}'
   ```

Important:
- Run BOTH npm run test AND npm run test:hurl before marking as resolved
- Do NOT modify tests to make them pass - fix the actual code
- Both tests must pass before marking as resolved
```

## Steps to Execute

### Step 1: Query Error

```bash
curl "${API_URL}/errors?days=7&status=open"
```

Find the error ID from the response.

### Step 2: Get Error Details

```bash
curl "${API_URL}/errors/{error_id}/export"
```

Analyze:
- Error message
- Stack trace
- Request path and method
- Parameters that caused the error

### Step 3: Run Baseline Tests

```bash
npm run test
npm run test:hurl
```

Document the test results. Both must pass before making changes.

### Step 4: Analyze and Fix

1. Review the stack trace to identify the root cause
2. Find the relevant source files
3. Make the necessary fix
4. Keep changes minimal and targeted

### Step 5: Verify Fix

```bash
npm run test
npm run test:hurl
```

Both tests must pass. If either fails, the fix is incomplete.

### Step 6: Mark Resolved

```bash
curl -X POST "${API_URL}/errors/{error_id}/resolve" \
  -H "Content-Type: application/json" \
  -d '{"resolution": "Fixed by [description]"}'
```

---

## Example Response Format

When providing the fix, structure your response as:

### Error Analysis
- Error message: ...
- Root cause: ...
- Affected files: ...

### Code Changes
```typescript
// Before
...

// After
...
```

### Test Results
```
npm run test: [PASS/FAIL]
npm run test:hurl: [PASS/FAIL]
```

### Resolution Command
```bash
curl -X POST "${API_URL}/errors/{error_id}/resolve" \
  -H "Content-Type: application/json" \
  -d '{"resolution": "..."}'
```

---

## Report Format

When reporting the fix, include:

### Error Classification Summary

| Category | Count | Action |
|----------|-------|--------|
| Total Found | X | - |
| Generated/Test | Y | **Skip** - expected behavior |
| System | Z | **Fix** - actual bugs |

### Generated Errors (Not Fixed)

Per [error-fix-workflow.rule.md](../rules/error-fix-workflow.rule.md), these test errors were skipped:
- ID: xxx (TestError - /errors/test/create)
- ID: xxx (TestError - /errors/test/create)
...

### System Errors Fixed

#### Error {error_id}
- **Error message**: ...
- **Root cause**: ...
- **Affected files**: ...

**Code Changes**:
```typescript
// Before
...

// After
...
```

### Test Results
```
npm run test: [PASS/FAIL]npm run test:hurl: [PASS/FAIL]
```

---

## Implementation Checklist

Per [error-fix-workflow.rule.md](../rules/error-fix-workflow.rule.md):

- [ ] Run baseline tests (`npm run test && npm run test:hurl`)
- [ ] Query and classify errors (filter test errors)
- [ ] Analyze error details and stack trace
- [ ] Identify root cause, not symptoms
- [ ] Make minimal, targeted fixes
- [ ] Run tests after fix - both must pass
- [ ] Provide clear resolution description
- [ ] Mark error as resolved
- [ ] Verify error filtered from open queries

---

## Common Error Types and Fixes

### CastError: Cast to ObjectId failed
**Cause**: Endpoint expects ObjectId but received string identifier

**Fix**: Update service method to check if identifier is valid ObjectId, query by alternative field (e.g., alias) if not

### TypeError: Cannot read property of undefined
**Cause**: Accessing property on possibly undefined value

**Fix**: Add null checks or use optional chaining

### ENOENT: No such file or directory
**Cause**: File path referenced doesn't exist

**Fix**: Check file existence before operations, handle missing files gracefully

### Generic "Internal Server Error" Message
**Cause**: Route handlers returning hardcoded "{ error: 'Internal server error' }" messages bypassing centralized error handling

**Fix**: Remove hardcoded error responses and let errors propagate to centralized error handler for consistent handling, logging, and client response format

---

## Error Prevention Guidelines

When writing new code, avoid:

- Returning hardcoded generic messages like `{ error: "Internal server error" }` 
- Bypassing the centralized error handling system
- Exposing internal technical details to clients in error responses
- Skipping comprehensive error logging

Instead, prefer:

- Allowing errors to propagate to the centralized error handler
- Using specific business error types that include contextual information
- Structuring errors to be caught and formatted consistently

---

## Important Notes

1. **Always establish baseline**: Run tests BEFORE making changes
2. **Both tests must pass**: Don't mark as resolved unless both `npm run test` and `npm run test:hurl` pass
3. **Fix the root cause**: Don't just patch the symptom
4. **Minimal changes**: Keep changes focused on fixing the specific error
5. **Test in isolation**: Verify the fix doesn't break other functionality
