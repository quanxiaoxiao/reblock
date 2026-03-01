# Error Fix Assist Prompt

Use this prompt when the user wants to fix a 500 error.

## Prompt Template

```
I need to fix a 500 error that occurred on the server.

Please follow the Error Fix Workflow:

1. First, query the error from the API:
   ```
   curl "http://localhost:4362/errors?days=7&status=open"
   ```

2. Get the error details using the export endpoint:
   ```
   curl "http://localhost:4362/errors/{error_id}/export"
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
   curl -X POST "http://localhost:4362/errors/{error_id}/resolve" \
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
curl "http://localhost:4362/errors?days=7&status=open"
```

Find the error ID from the response.

### Step 2: Get Error Details

```bash
curl "http://localhost:4362/errors/{error_id}/export"
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
curl -X POST "http://localhost:4362/errors/{error_id}/resolve" \
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
curl -X POST "http://localhost:4362/errors/{error_id}/resolve" \
  -H "Content-Type: application/json" \
  -d '{"resolution": "..."}'
```

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

---

## Important Notes

1. **Always establish baseline**: Run tests BEFORE making changes
2. **Both tests must pass**: Don't mark as resolved unless both `npm run test` and `npm run test:hurl` pass
3. **Fix the root cause**: Don't just patch the symptom
4. **Minimal changes**: Keep changes focused on fixing the specific error
5. **Test in isolation**: Verify the fix doesn't break other functionality
