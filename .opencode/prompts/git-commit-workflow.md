# Git Commit Workflow

> A comprehensive workflow for creating safe, well-tested git commits with automatic error repair.

---

## Purpose

Use this prompt when you want to:
1. Run all tests before committing
2. Automatically fix test failures (with confirmation)
3. Generate proper Conventional Commit messages
4. Create commits with confidence

---

## Workflow Overview

```
┌─────────────────┐
│ 1. Preparation  │ → Check status, git add .
└────────┬────────┘
         ↓
┌─────────────────┐
│ 2. Test Validation │ → npm run test + npm run test:hurl
└────────┬────────┘
         ↓
    ┌────┴────┐
    │         │
  PASS       FAIL
    │         │
    ↓         ↓
┌─────────┐ ┌──────────────┐
│ Generate│ │ 3. Repair    │ → Analyze, propose, confirm, fix
│ Commit  │ └──────┬───────┘
│ Message │        ↓
└────┬────┘ ┌─────────────────┐
     ↓      │ Re-run Tests    │
┌─────────┐ └────────┬────────┘
│ 5. Commit│          ↓
└─────────┘     Back to PASS
```

---

## Phase 1: Preparation

### Step 1.1: Check Git Status

```bash
git status
```

### Step 1.2: Stage All Changes

```bash
git add .
```

### Step 1.3: Show Changes Summary

```bash
git diff --cached --stat
```

---

## Phase 2: Test Validation

### Step 2.1: Run Unit Tests

```bash
npm run test
```

**Record result**: PASS or FAIL

### Step 2.2: Run Hurl API Tests

```bash
npm run test:hurl
```

**Record result**: PASS or FAIL

### Decision Point

- **Both PASS**: Proceed to Phase 4
- **Any FAIL**: Proceed to Phase 3

---

## Phase 3: Error Repair (When Tests Fail)

### Step 3.1: Analyze Failures

Examine the test output to identify:
- Which specific tests failed
- Error messages and stack traces
- Root causes of failures

### Step 3.2: Propose Fix

Following these TypeScript implementation rules from `.opencode/implementations/typescript/`:

**Key Rules to Follow:**
- `framework/ts-hono-layer.rule.md` - Router layer separation (no business logic in routers)
- `language/ts-dry-principle.rule.md` - No code duplication
- `framework/ts-zod-validation.rule.md` - Proper validation with Zod
- `orm/ts-mongoose.rule.md` - MongoDB/Mongoose patterns
- `testing/ts-hurl.rule.md` - Hurl test contract compliance
- `language/ts-import-syntax.rule.md` - Proper import syntax
- `project-structure/file-naming.md` - Consistent file naming
- `project-structure/directory-layout.md` - Project structure conventions

**Repair Principles:**
- Fix the root cause, not just the symptom
- Make minimal, targeted changes
- Do NOT modify tests to make them pass - fix the actual code
- Follow existing patterns in the codebase

### Step 3.3: Show Repair Proposal

Present to user:
- Summary of the issue
- Proposed code changes (before/after)
- Explanation of why this fixes the problem
- Confirmation prompt: "Apply this fix? [Y/n]"

### Step 3.4: Apply Fix (After Confirmation)

If user confirms:
1. Apply the code changes
2. Document what was fixed
3. Return to Phase 2 to re-run tests

If user declines:
- Ask user what they'd like to do instead
- Offer alternative approaches if available

---

## Phase 4: Generate Commit Message

### Step 4.1: Analyze Git Diff

```bash
git diff --cached
```

### Step 4.2: Generate Conventional Commit Message

Follow the format from `git-commit-message.md`:

```
type(scope): summary

- Detailed change 1
- Detailed change 2
- ...
```

**Types:**
- `feat` - New feature
- `fix` - Bug fix
- `refactor` - Code refactoring
- `perf` - Performance improvement
- `chore` - Build/tooling changes

**Guidelines:**
- Keep summary concise (under 50 characters)
- Use present tense ("fix" not "fixed")
- Include bullet points of key changes
- Reference issue IDs if applicable

### Step 4.3: Show Commit Message Preview

Display the generated commit message and ask for confirmation:

```
Proposed commit message:

fix(resource): handle missing file gracefully

- Add null check for file existence
- Return 404 instead of 500 when file missing
- Update error handling to follow existing patterns

Use this commit message? [Y/n]
```

---

## Phase 5: Execute Commit

### Step 5.1: Commit with Generated Message

After user confirmation:

```bash
git commit -m "type(scope): summary

- Detailed change 1
- Detailed change 2
"
```

### Step 5.2: Verify Commit

```bash
git log -1 --stat
```

Show the commit confirmation to the user.

---

## Error Handling

### If Tests Still Fail After Repair

1. Analyze the new failure
2. Determine if it's related to the previous fix or a new issue
3. Propose a new repair approach
4. Repeat Phase 3

### If User Interrupts Workflow

- Save current state (git status, test results)
- Provide summary of what was accomplished
- Offer to resume later

---

## Checklist

- [ ] Ran `git status` to check current state
- [ ] Ran `git add .` to stage all changes
- [ ] Ran `npm run test` - PASSED
- [ ] Ran `npm run test:hurl` - PASSED
- [ ] Followed TypeScript implementation rules for any fixes
- [ ] Generated Conventional Commit compliant message
- [ ] Got user confirmation before commit
- [ ] Successfully created git commit

---

## Example Complete Workflow

```
> Let's commit these changes!

[Phase 1] Preparation
git status → Shows 3 modified files
git add .
git diff --cached --stat → src/services/resourceService.ts, tests/...

[Phase 2] Test Validation
npm run test → PASS
npm run test:hurl → FAIL (resource delete test)

[Phase 3] Error Repair
Analyze: Missing null check in delete handler
Propose fix: Add existence check before deletion
User confirms: Yes
Apply fix
Re-run tests → ALL PASS

[Phase 4] Generate Commit Message
git diff --cached → Shows the null check addition
Generate: "fix(resource): add null check in delete handler"
User confirms: Yes

[Phase 5] Commit
git commit -m "fix(resource): add null check in delete handler"
git log -1 → Commit created successfully!

Done! 🎉
```

---

## References

- `.opencode/prompts/git-commit-message.md` - Commit message format
- `.opencode/prompts/error-fix-assist.md` - Error repair patterns
- `.opencode/implementations/typescript/` - TypeScript coding standards
- `.opencode/checklists/` - Additional verification checklists
