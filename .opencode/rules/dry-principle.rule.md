# DRY Principle (Don't Repeat Yourself)

**Rule ID**: dry-principle  
**Category**: Code Quality  
**Severity**: Warning  
**Applies to**: All TypeScript/JavaScript code, PR reviews

---

## Description

Every piece of knowledge must have a single, unambiguous, authoritative representation in a system. Code duplication is strictly prohibited.

---

## Requirements

### 1. Zero Tolerance for Duplication

**Code duplication is never acceptable.** If you write similar logic more than once, extract it.

#### Examples of Prohibited Duplication

**❌ WRONG: Duplicating streaming logic**
```typescript
// router1.ts - 100 lines of streaming code
router.get('/download', async (c) => {
  const stream = createReadStream(...);
  const decrypt = createDecryptStream(...);
  // ... 95 more lines
});

// router2.ts - Same 100 lines copied
router.get('/legacy/download', async (c) => {
  const stream = createReadStream(...);
  const decrypt = createDecryptStream(...);
  // ... 95 more lines (COPY-PASTE)
});
```

**✅ CORRECT: Extract and reuse**
```typescript
// router1.ts - exports reusable function
export async function handleDownload(c: Context, id: string, inline: boolean): Promise<Response> {
  // Single implementation
}

router.get('/download', async (c) => {
  return handleDownload(c, id, false);
});

// router2.ts - imports and reuses
import { handleDownload } from './router1';

router.get('/legacy/download', async (c) => {
  return handleDownload(c, id, false);
});
```

### 2. When to Extract

Extract reusable code when you encounter:

| Scenario | Action |
|----------|--------|
| Same logic in 2+ places | Extract to shared function |
| Similar validation logic | Extract to shared validator |
| Same error handling pattern | Extract to shared error handler |
| Identical type definitions | Move to shared types file |
| Same utility functions | Move to utils/ directory |

### 3. Extraction Patterns

#### Pattern A: Export from Existing Module

When one module already has the implementation, export it:

```typescript
// resourceRouter.ts
export async function handleResourceDownload(...) { ... }
export function parseRange(...) { ... }

// legacyRouter.ts
import { handleResourceDownload, parseRange } from './resourceRouter';
```

#### Pattern B: Create Shared Utilities

For truly shared code, create utility modules:

```typescript
// src/utils/streaming.ts
export async function createDecryptPipeline(...) { ... }
export function validateRangeHeader(...) { ... }

// Used by multiple routers
import { createDecryptPipeline } from '../utils/streaming';
```

#### Pattern C: Service Layer Abstraction

For business logic, use service layer:

```typescript
// src/services/downloadService.ts
export class DownloadService {
  async handleDownload(...) { ... }
}

// Used by all routers
const downloadService = new DownloadService();
```

### 4. Documentation Requirements

When extracting reusable code:

1. **Add JSDoc comments** explaining purpose and parameters
2. **Document the reuse** in PR description
3. **Update related files** to use the extracted function

```typescript
/**
 * Handle resource download with Range support
 * Extracted as reusable function to avoid code duplication (DRY principle)
 * @param c Hono Context
 * @param id Resource ID
 * @param inline Whether to display inline or as attachment
 * @param operationPrefix Prefix for log operations
 * @returns Response
 */
export async function handleResourceDownload(...) { ... }
```

### 5. Parameterization

Make extracted functions flexible through parameters:

```typescript
// Instead of multiple similar functions
export async function handleDownload(
  c: Context,
  id: string,
  inline: boolean,
  operationPrefix: string = 'stream'  // Allows customization
): Promise<Response> { ... }

// Usage
handleDownload(c, id, false, 'stream');        // New API
handleDownload(c, id, false, 'legacyStream');  // Legacy API
```

---

## Benefits

1. **Single Source of Truth**: Fix bugs in one place
2. **Consistency**: Same behavior across all routes
3. **Maintainability**: Easier to update and refactor
4. **Testing**: Test once, use everywhere
5. **Bundle Size**: Smaller code footprint
6. **Review Efficiency**: Less code to review

---

## PR Review Checklist

Reviewers must verify:
- [ ] No code duplication introduced
- [ ] Existing reusable functions are used when available
- [ ] New reusable functions are properly documented
- [ ] All call sites updated to use extracted functions
- [ ] No regression in functionality

---

## Exceptions

**No exceptions.** If you believe duplication is necessary, you must:
1. Document why DRY cannot be applied
2. Get approval from 2+ maintainers
3. Add detailed comments explaining the decision

---

## Examples in This Codebase

### Example 1: Download Handler Reuse

**Before (violated DRY)**:
- `resourceRouter.ts`: 200 lines of download logic
- `legacyRouter.ts`: 200 lines of identical download logic

**After (DRY compliant)**:
- `resourceRouter.ts`: Exports `handleResourceDownload()`
- `legacyRouter.ts`: Imports and calls `handleResourceDownload()`
- **Result**: 200 lines → 2 lines in legacyRouter

### Example 2: Range Parser

**Before**: `parseRange()` defined in both routers

**After**: `parseRange()` exported from `resourceRouter.ts`, imported by `legacyRouter.ts`

---

## Related Rules

- `architecture.rule.md` - Layered architecture
- `service-interface.rule.md` - Standardized service interfaces
- `hono-layer.rule.md` - Router responsibilities

---

## References

- [DRY Principle (Wikipedia)](https://en.wikipedia.org/wiki/Don%27t_repeat_yourself)
- [The Pragmatic Programmer](https://pragprog.com/titles/tpp20/the-pragmatic-programmer-20th-anniversary-edition/)
