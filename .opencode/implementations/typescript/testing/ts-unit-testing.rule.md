# TypeScript Unit Testing Rules

**Rule ID**: ts-unit-testing  
**Category**: Testing  
**Severity**: Critical  
**Framework**: Vitest  
**Applies to**: All TypeScript unit tests in `tests/unit/`

---

## Overview

Unit tests verify individual modules in isolation. Each test file corresponds to one source file and validates its public interface, edge cases, and error handling.

Violation Severity: CRITICAL - Missing unit tests for core modules blocks deployment.

---

## 1. Directory Organization

Mirror the source directory structure:

```
tests/unit/
├── routes/              # Router endpoint tests
│   ├── blockRouter.test.ts
│   ├── entryRouter.test.ts
│   └── ...
├── services/            # Business logic tests
│   ├── blockService.test.ts
│   ├── cryptoService.test.ts
│   └── ...
├── schemas/             # Validation schema tests
│   ├── blockSchema.test.ts
│   └── ...
├── utils/               # Utility function tests (NEW)
│   ├── crypto.test.ts
│   └── pagination.test.ts
├── middleware/          # Middleware tests (NEW)
│   ├── errorHandler.test.ts
│   └── validate.test.ts
├── scripts/             # Script tests
│   └── update-entry.test.ts
└── app.test.ts          # Application-level tests
```

### File Naming Convention

- **Pattern**: `{sourceFileName}.test.ts`
- **Example**: `src/services/blockService.ts` → `tests/unit/services/blockService.test.ts`
- **No exceptions**: Every testable source file MUST have a corresponding test file

---

## 2. Test Structure

### 2.1 Basic Test File Template

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModuleUnderTest } from '../../../src/path/to/module';

// Mock dependencies
vi.mock('../../../src/dependencies', () => ({
  dependency: {
    method: vi.fn(),
  },
}));

describe('ModuleName', () => {
  let instance: ModuleUnderTest;

  beforeEach(() => {
    vi.clearAllMocks();
    instance = new ModuleUnderTest();
  });

  describe('methodName', () => {
    it('should handle normal case', async () => {
      // Arrange
      const input = { /* test data */ };
      
      // Act
      const result = await instance.methodName(input);
      
      // Assert
      expect(result).toBeDefined();
      expect(result.status).toBe(200);
    });

    it('should handle edge case', async () => {
      // Test boundary conditions
    });

    it('should throw error for invalid input', async () => {
      // Test error scenarios
    });
  });
});
```

### 2.2 Required Test Sections

Every test file MUST include:

1. **Happy Path Tests** (minimum 1 per public method)
2. **Edge Case Tests** (null, empty, boundary values)
3. **Error Handling Tests** (exceptions, error codes)
4. **Integration Point Tests** (mocked dependencies)

---

## 3. Module-Specific Testing Requirements

### 3.1 Services (Business Logic)

**Location**: `tests/unit/services/*.test.ts`

**Requirements**:
- Mock all database models using `vi.mock()`
- Test all public methods
- Verify transaction handling
- Test error propagation

**Required Scenarios**:

| Method Type | Required Tests |
|-------------|---------------|
| Create | Valid data, validation errors, duplicate handling |
| Read | Found, not found, pagination, filtering |
| Update | Success, not found, partial updates, optimistic locking |
| Delete | Success, not found, cascade effects |
| Query | Pagination, sorting, filtering, empty results |

**Example - Service with Dual Storage**:

```typescript
describe('LogService', () => {
  describe('logIssue', () => {
    it('should log to both MongoDB and file system', async () => {
      // Verify dual storage strategy
    });

    it('should handle file system failure gracefully', async () => {
      // MongoDB should still work even if file write fails
    });

    it('should prevent duplicate entries within time window', async () => {
      // Test checkDuplicate logic
    });
  });
});
```

### 3.2 Routes (HTTP Endpoints)

**Location**: `tests/unit/routes/*.test.ts`

**Requirements**:
- Use Hono app instance for testing
- Mock service layer
- Test status codes, headers, response body
- Test validation middleware integration

**Required Scenarios**:

| Scenario | Required Tests |
|----------|---------------|
| Success | 200/201 status, correct response format |
| Validation | 400 status, error message format |
| Not Found | 404 status for missing resources |
| Server Error | 500 status, error ID in response |
| Authentication | 401/403 when auth required |
| Pagination | Query params, limit/offset validation |

**Example**:

```typescript
describe('BlockRouter', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.route('/blocks', blockRouter);
  });

  describe('GET /blocks', () => {
    it('should return list with pagination', async () => {
      const res = await app.request('/blocks?limit=10&offset=0');
      expect(res.status).toBe(200);
      
      const body = await res.json();
      expect(body.items).toBeDefined();
      expect(body.total).toBeDefined();
    });

    it('should return 400 for invalid pagination params', async () => {
      const res = await app.request('/blocks?limit=invalid');
      expect(res.status).toBe(400);
    });
  });
});
```

### 3.3 Schemas (Validation)

**Location**: `tests/unit/schemas/*.test.ts`

**Requirements**:
- Test Zod schema validation
- Verify success cases
- Test each validation rule failure
- Test type coercion

**Required Scenarios**:

| Test Type | Required |
|-----------|----------|
| Valid data | All required fields, all optional fields |
| Missing required | Each required field omitted |
| Invalid types | Wrong type for each field |
| Boundary values | Min/max values, empty strings, zero |
| Nested objects | Deep validation testing |

**Example**:

```typescript
describe('createBlockSchema', () => {
  it('should validate valid data', () => {
    const valid = {
      body: {
        sha256: 'abc123',
        linkCount: 1,
        size: 1024,
      },
    };
    expect(createBlockSchema.safeParse(valid).success).toBe(true);
  });

  it('should reject missing sha256', () => {
    const invalid = { body: { linkCount: 1 } };
    expect(createBlockSchema.safeParse(invalid).success).toBe(false);
  });
});
```

### 3.4 Utils (Utility Functions)

**Location**: `tests/unit/utils/*.test.ts`

**Requirements**:
- Test pure functions with various inputs
- Test error conditions
- Verify mathematical correctness
- Test boundary conditions

**Required Scenarios** (for security-critical utils like crypto):

| Test Type | Required |
|-----------|----------|
| Round-trip | Encrypt → Decrypt yields original |
| Wrong key | Decryption with wrong key fails |
| Corrupted data | Modified ciphertext fails |
| Edge cases | Empty input, max size input |
| Performance | Large data handling |

**Example - Crypto Utils**:

```typescript
describe('crypto utils', () => {
  describe('encryptBuffer/decryptBuffer', () => {
    it('should round-trip encrypt and decrypt', () => {
      const data = Buffer.from('sensitive data');
      const key = 'x'.repeat(32); // 256-bit key
      
      const encrypted = encryptBuffer(data, key);
      const decrypted = decryptBuffer(encrypted, key);
      
      expect(decrypted).toEqual(data);
    });

    it('should fail to decrypt with wrong key', () => {
      const data = Buffer.from('sensitive data');
      const encrypted = encryptBuffer(data, 'correct_key_'.repeat(2));
      
      expect(() => {
        decryptBuffer(encrypted, 'wrong_key___'.repeat(2));
      }).toThrow();
    });
  });
});
```

### 3.5 Middleware

**Location**: `tests/unit/middleware/*.test.ts`  
**Location**: `tests/unit/routes/middlewares/*.test.ts`

**Requirements**:
- Test middleware in isolation
- Mock context object
- Verify next() chain behavior
- Test error handling

**Required Scenarios**:

| Middleware Type | Required Tests |
|-----------------|---------------|
| Validation | Valid input proceeds, invalid returns 400 |
| Error Handler | Error logging, response format, status codes |
| Audit | Request logging, IP extraction, sensitive data redaction |
| Auth | Token validation, pass/fail scenarios |

**Example**:

```typescript
describe('validate middleware', () => {
  it('should call next() for valid input', async () => {
    const next = vi.fn();
    const c = createMockContext({ body: { valid: 'data' } });
    
    await validate(schema)(c, next);
    
    expect(next).toHaveBeenCalled();
  });

  it('should return 400 for invalid input', async () => {
    const next = vi.fn();
    const c = createMockContext({ body: { invalid: 'data' } });
    
    await validate(schema)(c, next);
    
    expect(c.res.status).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });
});
```

---

## 4. Mocking Standards

### 4.1 Module-Level Mocking

Use `vi.mock()` for external dependencies:

```typescript
// Mock entire module
vi.mock('../../../src/models', () => ({
  Block: {
    find: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
  },
  Resource: {
    findOne: vi.fn(),
  },
}));
```

### 4.2 Function Mocking

Use `vi.fn()` for spies and stubs:

```typescript
const mockFn = vi.fn();
mockFn.mockResolvedValue({ data: 'test' }); // For async
mockFn.mockReturnValue(true); // For sync
mockFn.mockRejectedValue(new Error('fail')); // For errors
```

### 4.3 Mock Reset

Always clear mocks between tests:

```typescript
beforeEach(() => {
  vi.clearAllMocks();
});
```

### 4.4 Partial Module Mocking

For partial mocks, use `vi.importActual()`:

```typescript
vi.mock('../../../src/utils', async () => {
  const actual = await vi.importActual('../../../src/utils');
  return {
    ...actual,
    expensiveFunction: vi.fn().mockReturnValue('mocked'),
  };
});
```

---

## 5. Assertion Best Practices

### 5.1 Prefer Specific Assertions

```typescript
// ✅ Good - Specific and informative
expect(result.items).toHaveLength(3);
expect(result.total).toBe(100);
expect(result.data).toEqual(expectedData);

// ❌ Bad - Too vague
expect(result).toBeTruthy();
expect(result.items.length > 0).toBe(true);
```

### 5.2 Test Error Scenarios

```typescript
// ✅ Good - Specific error testing
await expect(service.create(invalidData))
  .rejects
  .toThrow('Validation failed: sha256 is required');

// ❌ Bad - Just checking it throws
await expect(service.create(invalidData)).rejects.toThrow();
```

### 5.3 Async Testing

```typescript
// ✅ Good - Always await async operations
const result = await service.fetchData();
expect(result).toBeDefined();

// ✅ Good - Use resolves/rejects for promises
await expect(service.asyncOperation()).resolves.toBe(true);
await expect(service.failingOperation()).rejects.toThrow();
```

### 5.4 Object Comparisons

```typescript
// ✅ Good - Deep equality for objects
expect(result).toEqual({ id: '123', name: 'test' });

// ✅ Good - Partial matching
expect(result).toMatchObject({ id: '123' });
expect(result).toHaveProperty('createdAt');

// ❌ Bad - Reference equality
expect(result).toBe({ id: '123' }); // Will always fail
```

---

## 6. Coverage Requirements

### 6.1 Minimum Coverage Thresholds

| Metric | Minimum | Target |
|--------|---------|--------|
| Statements | 80% | 90% |
| Branches | 70% | 85% |
| Functions | 90% | 95% |
| Lines | 80% | 90% |

### 6.2 Critical Modules - 100% Coverage Required

These modules MUST have 100% coverage:

- `src/utils/crypto.ts` - Security-critical encryption
- `src/services/logService.ts` - Core logging infrastructure
- `src/routes/middlewares/errorHandler.ts` - Error handling
- `src/routes/middlewares/validate.ts` - Input validation
- `src/config/env.ts` - Configuration validation

### 6.3 Coverage Exemptions

Allowed exemptions (with justification):

- Type definitions (`*.d.ts`)
- Barrel export files (`index.ts`)
- Generated code
- Debug-only code paths

---

## 7. Priority Matrix for Missing Tests

Based on coverage analysis, implement tests in this order:

### 🔴 Phase 1: Critical (Blocks Deployment)

1. **src/utils/crypto.ts** (193 lines)
   - Encryption/decryption round-trip
   - Stream encryption with offset
   - Error handling for invalid keys

2. **src/services/logService.ts** (818 lines)
   - Dual storage (MongoDB + filesystem)
   - Duplicate detection
   - Status transitions
   - File archival

3. **src/routes/middlewares/errorHandler.ts** (130 lines)
   - Error ID generation
   - Fingerprint calculation
   - Fallback logging
   - Response formatting

### 🟡 Phase 2: High Priority

4. **src/routes/errorRouter.ts** (598 lines)
   - All 6 endpoints
   - Authentication
   - Filter combinations
   - Export functionality

5. **src/routes/middlewares/validate.ts** (26 lines)
   - Validation success/failure
   - Error message format

6. **src/services/auditService.ts** (80 lines)
   - File writing
   - IP extraction
   - Date-based rotation

### 🟢 Phase 3: Medium Priority

7. **src/routes/middlewares/requestCapture.ts** (115 lines)
8. **src/routes/legacyRouter.ts** (180 lines)
9. **src/routes/migrationRouter.ts** (224 lines)
10. **src/routes/metricsRouter.ts** (58 lines)
11. **src/middleware/audit.ts** (65 lines)
12. **src/utils/pagination.ts** (111 lines)
13. **src/config/env.ts** (69 lines)

### ⚪ Phase 4: Low Priority

14. Simple barrel exports and type definitions

---

## 8. Running Tests

### Commands

```bash
# Run all unit tests
npm run test

# Run in watch mode
npm run test:watch

# Run with coverage
npm run test:coverage

# Run specific test file
npx vitest run tests/unit/services/crypto.test.ts
```

### Pre-Commit Requirements

Before committing:

- [ ] All tests pass
- [ ] Coverage meets minimum thresholds
- [ ] No test-only code in production
- [ ] No `console.log` in tests (use `console.error` for errors)

---

## 9. Common Patterns

### 9.1 Testing Time-Dependent Code

```typescript
// Use fake timers
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2024-01-01'));
});

afterEach(() => {
  vi.useRealTimers();
});
```

### 9.2 Testing File System Operations

```typescript
// Mock fs module
vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue('data'),
  existsSync: vi.fn().mockReturnValue(true),
}));
```

### 9.3 Testing Stream Operations

```typescript
import { Readable, Writable } from 'stream';

const createMockStream = (data: Buffer) => {
  const stream = new Readable();
  stream.push(data);
  stream.push(null);
  return stream;
};
```

### 9.4 Testing Private Methods

```typescript
// Access private methods via type assertion
const result = await (service as any).privateMethod();
```

---

## 10. Troubleshooting

### Test Failures

1. **"Cannot find module"** - Check import paths
2. **"expect(received).toBe(expected)"** - Use `toEqual` for objects
3. **Async timeout** - Ensure all promises are awaited
4. **Mock not called** - Check `vi.clearAllMocks()` placement

### Coverage Gaps

1. Run `npm run test:coverage` to identify uncovered lines
2. Add tests for error branches
3. Test edge cases (null, undefined, empty)
4. Verify all public methods have tests

---

## References

- [Vitest Documentation](https://vitest.dev/)
- [Hono Testing](https://hono.dev/docs/guides/testing)
- [Zod Testing Patterns](https://zod.dev/)
- `ts-hurl.rule.md` - Integration testing standards
- `ts-dry-principle.rule.md` - Avoid test duplication

---

## Checklist for New Test Files

When creating a new test file, verify:

- [ ] File follows naming convention: `{source}.test.ts`
- [ ] Located in correct directory matching source structure
- [ ] All public methods have tests
- [ ] Happy path, edge cases, and errors covered
- [ ] Mocks properly configured and cleared
- [ ] Assertions are specific and informative
- [ ] Coverage meets minimum requirements
- [ ] No `any` types without justification
- [ ] Test descriptions are clear and concise
