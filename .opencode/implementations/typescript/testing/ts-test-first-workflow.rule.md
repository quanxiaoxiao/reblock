# Test-First Workflow Rule (TypeScript)

**Rule ID**: ts-test-first-workflow  
**Category**: Engineering Process  
**Severity**: CRITICAL  

---

## Core Principle

Implementation MUST follow this strict order:

1. Rules
2. OpenAPI contract
3. Unit tests
4. Hurl tests
5. Implementation code

Violation Severity: CRITICAL

---

## Execution Order

### Phase 1 – Contract Lock

Before writing implementation:

- Ensure OpenAPI is finalized
- Ensure .opencode/rules are satisfied
- Ensure timestamp & soft-delete rules applied

Implementation MUST NOT begin if:

- OpenAPI is missing
- Required tests are missing

---

### Phase 2 – Generate Unit Tests (Without Viewing src)

OpenCode MUST:

- Ignore src implementation
- Read only:
  - OpenAPI
  - .opencode/rules
  - existing test files

Goal:
Tests must define behavior contract, not reflect implementation.

---

### Phase 3 – Generate Hurl Tests

OpenCode MUST:

- Generate Hurl tests from OpenAPI
- Enforce pagination rules
- Enforce lifecycle cleanup
- Enforce 404-after-delete contract

---

### Phase 4 – Implementation

Only after tests exist:

OpenCode may generate:

- schemas
- services
- routers
- models

Implementation MUST satisfy:

- All unit tests
- All Hurl tests
- All rules

---

## Forbidden

❌ Generating implementation before tests  
❌ Modifying tests to satisfy broken implementation  
❌ Removing asserts to make tests pass  
❌ Weakening test coverage  

---

## Enforcement Strategy

If tests fail:

1. Fix implementation
2. Do NOT change test contract
3. Do NOT bypass rule validation

---

## Rationale

This ensures:

- Deterministic behavior
- Replaceable implementation
- Stable contract-driven architecture
- Safe AI refactoring
