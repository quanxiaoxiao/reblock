# ESLint Error Fix Workflow

> Automated detection and fixing of ESLint errors with TypeScript compliance

## When to Use

Use this workflow when `npm run lint` reports errors.

## Workflow Overview

```
┌─────────────────┐
│ 1. Detection    │ → Run npm run lint
└────────┬────────┘
         ↓
┌─────────────────┐
│ 2. Review       │ → Check TypeScript rules
└────────┬────────┘
         ↓
┌─────────────────┐
│ 3. Fix          │ → Fix by error type
└────────┬────────┘
         ↓
┌─────────────────┐
│ 4. Verification │ → Re-run lint
└─────────────────┘
```

## Rules to Review

Before fixing, review these files:
- `.opencode/implementations/typescript/language/ts-import-syntax.rule.md`
- `.opencode/implementations/typescript/language/ts-dry-principle.rule.md`
- `.opencode/implementations/typescript/scripts/ts-scripts-import.rule.md`

## Common Error Fix Strategies

### 1. no-unused-vars (Unused Variables)

**Strategy**: 
- Delete unused imports and variables
- Or add `_` prefix (if ESLint configured with `argsIgnorePattern: '^_'`)

**Example**:
```javascript
// Before
import { c, logBanner, logSection } from '../utils/style.mjs';

// After - remove unused
import { logBanner } from '../utils/style.mjs';
```

### 2. preserve-caught-error (Missing Error Cause)

**Strategy**: Use `{ cause: error }` to preserve original error

**Example**:
```javascript
// Before
} catch (error) {
  throw new Error(`Command failed: ${command}`);
}

// After
} catch (error) {
  throw new Error(`Command failed: ${command}`, { cause: error });
}
```

### 3. no-control-regex (Control Character Regex)

**Strategy**: Add ESLint disable comment

**Example**:
```javascript
// Before
const titlePad = text.replace(/\x1b\[[^m]*m/g, '');

// After
// eslint-disable-next-line no-control-regex
const titlePad = text.replace(/\x1b\[[^m]*m/g, '');
```

### 4. @typescript-eslint/no-unused-expressions (Unused Expressions)

**Strategy**: Wrap with `void()`

**Example**:
```javascript
// Before
health.exists ? ok('Found') : fail('Not found');

// After
void (health.exists ? ok('Found') : fail('Not found'));
```

### 5. no-useless-escape (Unnecessary Escape)

**Strategy**: Remove unnecessary backslashes

**Example**:
```javascript
// Before
tr -d \"

// After
tr -d "
```

### 6. @typescript-eslint/no-empty-object-type (Empty Interface)

**Strategy**: Add ESLint disable comment or convert to type alias

**Example**:
```typescript
// Before
export interface AdmissionRuntimeSnapshot extends AdmissionRuntimeState {}

// After
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface AdmissionRuntimeSnapshot extends AdmissionRuntimeState {}
```

## Fix Principles

1. **DRY Principle**: Remove dead code, don't leave unused variables or functions
2. **Minimal Changes**: Only fix lint errors, don't change business logic
3. **Document Reasons**: Ensure ESLint disable comments have valid reasons
4. **Test Verification**: Run `npm run lint` after fixes to confirm all errors resolved

## Example Workflow

```bash
# Step 1: Detection
npm run lint

# Output example:
# 29 errors found

# Step 2: Categorize errors
# - 14 no-unused-vars
# - 2 preserve-caught-error
# - 3 no-control-regex
# - 5 no-unused-expressions
# - 1 no-empty-object-type
# - etc...

# Step 3: Batch fix
# Apply strategies above to fix each error

# Step 4: Verification
npm run lint
# ✓ 0 errors remaining
```

## Important Notes

- **Errors vs Warnings**: Only fix errors, warnings can be temporarily ignored
- **.mjs Files**: Files in scripts/ directory follow special rule overrides
- **TypeScript Files**: .ts files in src/ follow standard TypeScript ESLint rules
- **Don't Modify Tests**: Fix source code, don't modify test files to pass lint

## Checklist

After fixing, verify:
- [ ] `npm run lint` shows 0 errors
- [ ] All changes follow TypeScript rule documentation
- [ ] No new business logic changes introduced
- [ ] Deleted code is truly dead code (not used anywhere)
