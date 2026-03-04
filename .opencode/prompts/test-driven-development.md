# Test-Driven Development (TDD) Prompt

> A structured workflow for practicing test-driven development in the Reblock project

Use this prompt when developing new features or refactoring existing functionality using TDD principles.

---

## Purpose

Guide developers through a strict test-driven development cycle following the "Red, Green, Refactor" pattern to ensure high-quality, well-validated code in the Reblock project.

---

## TDD Cycle

```
┌─────────────────┐
│ Write Failing   │ ← Red: Write a test that fails  
│ Test (RED)      │   because the functionality 
└────────┬────────┘   doesn't exist yet
         ↓
┌─────────────────┐
│ Make Test       │ ← Green: Implement minimum
│ Pass (GREEN)    │   functionality to pass test  
└────────┬────────┘
         ↓
┌─────────────────┐
│ Refactor        │ ← Refactor code while keeping
│ Code (REFACTOR) │   tests passing and improving
└────────┬────────┘   design and clarity
         ↓
    BACK TO RED
```

---

## Phase 1: Red - Write Failing Test

### For Features Touching Routers/Services (`npm run test` + `npm run test:hurl`)

```bash
# 1. Write unit test first - define expected behavior
describe('Feature Name', () => {
  it('should behave in a specific way', async () => {
    // Write test that SHOULD fail because feature isn't implemented
  });
});

# 2. Run the test to confirm it fails
npm run test

# 3. Write Hurl test for API contract compliance
# Create file: tests/hurl/feature/[operation-name].hurl
```

### Example Hurl Test Structure (for feature requiring API changes):
```hurl
GET http://localhost:4362/api/endpoint
HTTP/1.1 200
[Asserts...]
```

### Guidelines for Writing Initial Tests:
- Focus on a single behavior per test
- Follow the existing patterns in the `.opencode/implementations/typescript/testing/` directory
- Use meaningful test descriptions following BDD style: "should [behavior] when [condition]"
- Follow the 500 status error handling improvements: avoid hardcoded "Internal Server Error" and provide meaningful error messages
- Consult `.opencode/checklists/api-checklist.md` for API development standards

---

## Phase 2: Green - Make Test Pass

### Minimum Viable Implementation

Write the simplest possible code that makes your test pass:

- For router endpoints, implement only the specific request/response flow you tested
- For service methods, implement only the business logic requirements from your test
- Avoid premature optimizations or adding extra functionality that your test doesn't cover
- Follow the centralized error handling pattern to avoid hardcoded error messages
- Ensure all new code follows the patterns in `.opencode/implementations/typescript/`

### Run Tests Frequently

```bash
# After every small code change:
npm run test

# For API features:
npm run test:hurl
```

### When Tests Pass:
- Celebrate the green bar! ✅
- Verify no other tests became broken by running complete test suite: `npm run test && npm run test:hurl`

---

## Phase 3: Refactor - Improve Design

### Safe Refactoring with Test Safety Net

Now that tests are passing, you can confidently:
- Improve code readability
- Extract common functions 
- Remove duplications
- Optimize performance
- Consolidate error handling (especially removing hardcoded "Internal Server Error" messages)

### Refactoring Guidelines:
- Run tests after every small refactoring step: `npm run test`
- If tests break during refactor, undo the change immediately
- Apply lessons from `.opencode/checklists/error-handling.checklist.md` to improve error handling during refactoring
- Adhere to DRY (Don't Repeat Yourself) principles per `.opencode/implementations/typescript/language/ts-dry-principle.rule.md`
- Ensure no regression in existing functionality

---

## TDD Workflow Steps

### Step 1: Feature Understanding
1. **Clarify requirements**: What should the feature do?
2. **Define inputs/outputs**: What data comes in, what goes out?
3. **Identify edge cases**: What happens with invalid/boundary inputs?

### Step 2: Test Planning  
1. **Unit tests first**: Test in isolation at service layer
2. **Integration tests**: Test API contract with Hurl
3. **Error cases**: Test validation and error handling paths

### Step 3: Implementation Cycle
1. **Write one test** - Small, focused
2. **Verify it fails** - Run and confirm RED
3. **Implement minimum** - Only enough to turn GREEN
4. **Run all tests** - Confirm everything still passes
5. **Refactor safely** - If needed, keeping tests GREEN

### Step 4: Verification
- [ ] `npm run test` = PASS
- [ ] `npm run test:hurl` = PASS  
- [ ] No hardcoded "Internal Server Error" messages introduced (follow error handling checklist)
- [ ] Code is clean and follows TypeScript standards
- [ ] All business rules properly enforced
- [ ] Error messages are informative and secure

---

## Common Anti-Patterns to Avoid

1. **Writing too much implementation code** before making test pass
2. **Skipping the failing test step** - Always verify the red state first
3. **Implementing more than tests require** - Only implement what the current test demands
4. **Introducing hardcoded error messages** - Use proper error handling patterns
5. **Refactoring during green phase** - Wait until after implementation passes

---

## TDD Best Practices

### Writing Effective Tests
- Test behavior, not internal implementation details
- Use descriptive test names that read like specifications
- Follow the AAA pattern: Arrange, Act, Assert
- Keep tests independent - each should run in isolation
- Mock external dependencies to test only the code under test

### Error Handling During TDD
- When adding new error scenarios, remember the recent improvements to remove hardcoded "Internal Server Error" messages
- Use appropriate error types that provide meaningful info to callers
- Ensure errors flow through the centralized handler correctly
- Follow conventions in `.opencode/rules/error-handling.rule.md`

### Integration with Development Practices
- Apply the principles from `.opencode/checklists/api-checklist.md` when creating API endpoints
- Use validation properly per `.opencode/implementations/typescript/framework/ts-zod-validation.rule.md`
- Follow the layer structure: services → routes → controller → model (per framework rules)

---

## Example TDD Session

**Goal**: Add a feature to validate block size before resource upload

1. **RED**:
   ```typescript
   // Write test: should reject uploads exceeding max size limitation
   it('should return 400 when file exceeds max size', () => {...});
   ```
   Verify test fails: `npm run test`
   
2. **GREEN**:
   ```typescript
   // Implement: Add size check in uploadService with validation
   if(size > MAX_SIZE) throw new ValidationError(...);
   ```
   Verify test passes: `npm run test`
   Run complete tests: `npm run test && npm run test:hurl`

3. **REFACTOR**:
   - Improve error message to be informative
   - Ensure error follows format without hardcoded "Internal Server Error"
   - Check for duplications with other validation logic
   - Run all tests after each refactoring change

Confirm both `npm run test` and `npm run test:hurl` continue passing

---

## References

- `.opencode/prompts/git-commit-workflow.md` - Safe testing & committing practices
- `.opencode/rules/error-handling.rule.md` - Error handling patterns  
- `.opencode/checklists/api-checklist.md` - API implementation standards
- `.opencode/checklists/error-handling.checklist.md` - Error handling best practices
- `.opencode/implementations/typescript/` - TypeScript conventions
- `tests/unit/` - Unit test examples in existing codebase
- `tests/hurl/` - Hurl test examples in existing codebase