# Scripts Import Rule

This rule applies only to `scripts/**/*.mjs` files and standardizes module import patterns in scripts.

---

## Background

Script files in the scripts directory use ES Module (`.mjs`) format and run TypeScript source directly via `tsx`. Therefore, they must import from the `src/` directory, not the compiled `dist/` directory.

---

## Rules

### 1. No Imports from dist Directory

**Incorrect Example**:
```javascript
// ❌ Wrong: Importing from dist directory
const { logService } = await import('../dist/services/logService.js');
const { Block } = await import('../dist/models/block.js');
```

**Correct Example**:
```javascript
// ✅ Correct: Importing TypeScript source from src directory
const { logService } = await import('../src/services/logService.ts');
const { Block } = await import('../src/models/block.ts');
```

### 2. Must Use Dynamic Import Format

Since current script files are in `.mjs` format, dynamic imports must be used:

```javascript
// ✅ Correct: Dynamic import of TypeScript files from src directory
const { logService } = await import('../src/services/logService.ts');
```

---

## Common Scenarios

### Importing Services

```javascript
// ✅ Correct
const { logService } = await import('../src/services/logService.ts');

// ❌ Wrong
const { logService } = await import('../dist/services/logService.js');
```

### Importing Models

```javascript
// ✅ Correct
const logEntryModule = await import('../src/models/logEntry.ts');
const { LogCategory } = logEntryModule;

// ❌ Wrong
const logEntryModule = await import('../dist/models/logEntry.js');
```

### Importing Node.js Built-in Modules

Node.js built-in modules can be used directly without dynamic import:

```javascript
// ✅ Correct: Node.js built-in modules
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
```

**Exception**: If you need to import at runtime in special cases, use standard dynamic import format:

```javascript
// ✅ Allowed: Standard dynamic import for Node.js modules
const crypto = await import('crypto');
const fs = await import('fs');
```

---

## Temporary Note

This rule is a temporary solution. Future plans:

1. Refactor `.mjs` scripts to `.ts` files
2. Use static `import` statements instead of dynamic imports
3. Remove the `no-restricted-syntax` exemption in ESLint

After refactoring, code in the scripts directory will follow the main project's [import-syntax.rule.md](./import-syntax.rule.md).

---

## ESLint Configuration

This rule is implemented via `no-restricted-imports`:

```javascript
'no-restricted-imports': [
  'error',
  {
    patterns: [
      {
        group: ['**/dist/**', '../dist/**', './dist/**'],
        message: 'Scripts must import from src/ directory. Use: await import("../src/...")',
      },
    ],
  },
],
```

---

## Related Files

- `eslint.config.mjs` - ESLint configuration
- `package.json` - npm scripts configuration (doctor, cleanup, etc.)
- `scripts/*.mjs` - Affected script files
- [import-syntax.rule.md](./import-syntax.rule.md) - Main project import rules (scripts will follow this in the future)
