# Apply Rules Refactor (GLOBAL)

You must refactor the EXISTING codebase so that it fully complies
with ALL rules defined under `.opencode/rules`.

This is NOT a rewrite.
This is a rule-driven reconciliation.

---

## Scope

Refactor ONLY implementation details.

DO NOT:

- change API routes
- change response shapes
- rename modules
- regenerate project structure

---

## Mandatory Process

### 1. Load Rules

You MUST read ALL rules:

.opencode/rules/*.rule.md

Rules override existing implementation.

---

### 2. Detect Violations

Scan:

src/services/**
src/models/**
src/routes/**

Find violations against rules.

---

### 3. Apply Fix Strategy

#### Business Uniqueness Rule

If a business-unique field exists:

Service MUST include:

- uniqueness guard before create
- uniqueness guard before update
- soft-delete aware query
- 409 conflict error

Inject helper functions when missing.

---

### 4. Refactor Style

- minimal diff
- preserve naming
- extract reusable guards
- avoid router changes

---

### 5. Output

Return ONLY modified files.

Do not output explanations.

