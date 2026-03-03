# TypeScript File Naming Conventions

This document defines the file naming conventions for TypeScript implementations of the Reblock service.

---

## General Principles

- Use **kebab-case** for directory names
- Use **camelCase** for file names (with `.ts` extension)
- Use **PascalCase** for class names and type definitions
- Use **UPPER_SNAKE_CASE** for constants and enums

---

## Directory Naming

All directories use kebab-case:

```
src/
├── config/
├── middleware/
├── models/
├── routes/
├── schemas/
├── services/
├── types/
└── utils/
```

---

## File Naming by Type

### Source Files (.ts)

Use camelCase for all TypeScript source files:

| Pattern | Example |
|---------|---------|
| Service files | `blockService.ts`, `resourceService.ts` |
| Route files | `blockRouter.ts`, `entryRouter.ts` |
| Model files | `index.ts`, `logEntry.ts` |
| Schema files | `[resource]Schema.ts` |
| Utility files | `crypto.ts`, `helpers.ts` |
| Middleware files | `audit.ts`, `errorHandler.ts` |
| Configuration files | `env.ts` |

### Test Files

Use the same name as the file being tested, with `.test.ts` suffix:

```
tests/unit/
├── services/
│   ├── blockService.test.ts
│   └── resourceService.test.ts
└── routes/
    ├── blockRouter.test.ts
    └── resourceRouter.test.ts
```

### Script Files

Use kebab-case with `.mjs` extension for Node.js ESM scripts:

```
scripts/
├── doctor.mjs
├── cleanup.mjs
└── logs-analyze.mjs
```

### Markdown Files

Use kebab-case for documentation files:

```
.opencode/
├── docs/
│   ├── state-lifecycle.md
│   └── api-examples.md
└── rules/
    ├── architecture.rule.md
    └── data-model.rule.md
```

---

## Class and Type Naming

### Classes

Use PascalCase for class names:

```typescript
class BlockService { }
class ResourceService { }
class UploadBusinessError extends Error { }
```

### Interfaces and Types

Use PascalCase, prefixed with `I` for interfaces:

```typescript
interface IBlock { }
interface IResource { }
type PaginatedResult<T> = { };
```

### Enums

Use PascalCase for enum names, UPPER_SNAKE_CASE for values:

```typescript
enum LogLevel {
  CRITICAL = 'CRITICAL',
  ERROR = 'ERROR',
  WARNING = 'WARNING',
  INFO = 'INFO'
}
```

---

## Constants

Use UPPER_SNAKE_CASE for constants:

```typescript
const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024; // 10 GB
const DEFAULT_PAGE_LIMIT = 50;
const LOG_TTL_DAYS = 90;
```

---

## Variables and Functions

Use camelCase for variables and functions:

```typescript
const blockId = '...';
const resourceName = 'document.pdf';

async function getBlockById(id: string): Promise<IBlock | null> { }
function calculateStoragePath(sha256: string): string { }
```

---

## React/Component Files (if applicable)

Use PascalCase for React component files:

```
components/
├── Header.tsx
├── FileUploader.tsx
└── ResourceList.tsx
```

---

## Summary Table

| Item | Convention | Example |
|------|-----------|---------|
| Directories | kebab-case | `src/services/` |
| Source files | camelCase.ts | `blockService.ts` |
| Test files | camelCase.test.ts | `blockService.test.ts` |
| Script files | kebab-case.mjs | `doctor.mjs` |
| Classes | PascalCase | `class BlockService` |
| Interfaces | PascalCase with I | `interface IBlock` |
| Types | PascalCase | `type PaginatedResult` |
| Enums | PascalCase (names), UPPER_SNAKE_CASE (values) | `enum LogLevel { CRITICAL }` |
| Constants | UPPER_SNAKE_CASE | `const MAX_FILE_SIZE` |
| Variables/Functions | camelCase | `const blockId`, `function getBlock()` |

---

## Exceptions

- `index.ts` - Always uses this name for barrel files
- Configuration files like `tsconfig.json`, `eslint.config.mjs` follow tool conventions
- Markdown rule files use `.rule.md` suffix
