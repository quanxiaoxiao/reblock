# Test Troubleshooting Prompt

> Guidance for resolving test failures with `npm run test` and `npm run test:hurl`

Use this prompt when facing test failures during development or CI.

---

## Purpose

Troubleshoot and resolve test failures in the Reblock project, with clear guidance for both unit tests (`npm run test`) and integration tests (`npm run test:hurl`).

---

## Diagnosis Steps

### Phase 1: Identify Test Failure Type

```bash
# Run unit tests and capture failures
npm run test 2>&1 | grep -A 10 -B 5 "FAIL\\|Error\\|AssertionError"
```

```bash
# Run Hurl tests and capture failures  
npm run test:hurl 2>&1 | grep -A 10 -B 5 "FAILED\\|404\\|500\\|assertion"
```

### Phase 2: Categorize Failure

1. **Unit Tests (`npm run test`) Failures:**
   - Service logic errors
   - Model validation issues
   - Schema violations
   - Incorrect data transformations

2. **Integration Tests (`npm run test:hurl`) Failures:**
   - API contract violations
   - Incorrect HTTP status codes
   - Response format mismatches
   - Route availability issues

---

## Troubleshooting Workflow

### Step 1: Run Focused Diagnostics

1. **If unit tests fail**: `npm run test -- --run <specific-file>`
2. **If Hurl tests fail**: `npm run test:hurl -- --file=<specific-file>`
3. **Get verbose output**: Add `--reporter=verbose` flag

### Step 2: Analyze Error Context

For each test failure, identify:

1. **Which module/service/component** had the issue
2. **Error type**: validation, assertion, runtime, network, etc.
3. **Stack trace location** including exact function/file
4. **Expected vs actual results**

### Step 3: Common Failure Patterns

#### Pattern 1: Schema/Business Rule Violations
- **Symptom**: Validation errors in unit tests
- **Location**: schema files or business logic 
- **Fix**: Update schemas to match new requirements or fix business logic

#### Pattern 2: API Contract Inconsistencies  
- **Symptom**: Hurl tests failing with status 4xx/5xx
- **Location**: Route definitions vs actual API responses
- **Fix**: Either update routes to match contract OR update Hurl scripts to match implemented API

#### Pattern 3: Mock/Setup Issues
- **Symptom**: Tests failing due to misconfigured mocks
- **Location**: Unit test mock setup
- **Fix**: Ensure mocks properly simulate expected behaviors

---

## Resolution Strategies

### Unit Test (`npm run test`) Issues

```bash
# Get detailed unit test output
npm run test -- --verbose

# Rerun failed tests only
npm run test -- --runTestsByPath "path/to/failing_test.ts"

# Run with debugging
DEBUG=* npm run test
```

**Common fixes:**
- Update test expectations that are out of date with code changes
- Fix business logic when tests reveal real bugs
- Update test doubles and mock values to match new interfaces

### Integration Test (`npm run test:hurl`) Issues

```bash
# Get detailed Hurl output
npm run test:hurl -- -v

# Run specific Hurl test file
npm run test:hurl -- tests/hurl/<specific-test-file>.hurl

# Validate against OpenAPI spec
curl http://localhost:4362/openapi.json | jq .
```

**Common fixes:**
- Update response status codes to match API specifications
- Fix response structures to match contract
- Resolve authentication/authorization issues in test requests

---

## Before Retesting Checklist

- [ ] **Unit tests pass**: Verify `npm run test` passes completely
- [ ] **Hurl tests pass**: Verify `npm run test:hurl` passes completely  
- [ ] **API endpoints validate**: Confirm OpenAPI contract matches implementation
- [ ] **Business rules implemented**: Check that all validations match documentation

### Final Verification Process

```bash
# Run complete test suite to confirm fix
npm run test
npm run test:hurl

# Verify error handling still works (per recent improvements)
# Confirm that any "Internal Server Error" messages have been replaced
# with more informative actual error responses
```

---

## Integration with Development Workflow

Following the recent removal of "Internal Server Error" messages (as per `.opencode/checklists/error-handling.checklist.md`), ensure that:

1. Any error handling fixes maintain meaningful error messages
2. API error responses are consistent with centralized error handler
3. Error messages are actionable for debugging
4. Security is maintained (no sensitive information leaked in error responses)

---

## References

- `.opencode/checklists/error-handling.checklist.md` - Error handling best practices
- `.opencode/prompts/error-fix-assist.md` - Error repair procedures
- `.opencode/rules/error-handling.rule.md` - Error handling patterns
- `tests/hurl/` - Hurl integration test examples
- `tests/unit/` - Unit test examples