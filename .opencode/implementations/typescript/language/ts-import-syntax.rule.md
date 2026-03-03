# Import Syntax Rule

All code must use ES Module static import syntax. CommonJS and dynamic imports are forbidden.

---

## Rules

1. **No `require()`** - This is CommonJS syntax, this project uses ES Modules
2. **No `await import()`** - Dynamic imports are allowed only in special scenarios, code should use static imports
3. **All imports at top of file** - Use standard ES Module import syntax

---

## Correct Examples

```typescript
// ✅ Correct: Static imports at top of file
import { logService } from '../services/logService';
import { Block } from '../models/block';
import type { IBlock } from '../models/block';

export async function processBlock(id: string) {
  const block = await Block.findById(id);
  await logService.logIssue({...});
}
```

---

## Incorrect Examples

```typescript
// ❌ Wrong: Using require()
const fs = require('fs');

// ❌ Wrong: Using dynamic import
async function init() {
  const { logService } = await import('../services/logService');
}

// ❌ Wrong: Conditional import (also dynamic)
if (condition) {
  const module = await import('./module');
}
```

---

## Exceptions

The following cases may disable this rule individually in ESLint config:

1. Config file loading (early stage before loading .env files)
2. Dynamic mocks in test files
3. Build tool scripts

**Note**: Script files (scripts/*.mjs) are being refactored and will be changed to TypeScript with static imports later.

---

## Why This Design

1. **Consistency**: Unified ES Module syntax, avoiding mixed CommonJS and ES Module
2. **Analyzable**: Static imports make dependency relationships clear for tool analysis and tree-shaking
3. **Type-safe**: TypeScript provides better type inference for static imports
4. **Code style**: Imports at top of file is standard practice, improves readability

---

## ESLint Configuration

This rule is implemented via `no-restricted-syntax`:

```javascript
'no-restricted-syntax': [
  'error',
  {
    selector: "CallExpression[callee.name='require']",
    message: 'Use ES module import syntax instead of require()',
  },
  {
    selector: "ImportExpression",
    message: 'Use static import statements at the top of the file instead of dynamic import()',
  },
],
```

---

## Related Files

- `eslint.config.mjs` - ESLint configuration file
- `scripts/*.mjs` - Script files pending refactor (this rule temporarily disabled)
