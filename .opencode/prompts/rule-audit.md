# Rule Audit — Architecture Compliance Scanner

You are performing a **READ-ONLY architectural audit**.

Your task is to verify that the existing codebase strictly complies
with ALL rules defined under:

.opencode/rules/*.rule.md

This prompt MUST NEVER modify code.

---

## Objective

Produce a deterministic violation report describing where the
implementation diverges from architectural rules.

This acts as an **architecture linter**.

---

## Scope

Scan ONLY:

src/models/**
src/services/**
src/routes/**
src/schemas/**

Ignore build files, configs, tests, and node_modules.

---

## Mandatory Process

### 1. Load Rules (REQUIRED)

You MUST read and apply ALL rule files:

- architecture.rule.md
- hono-layer.rule.md
- mongoose.rule.md
- service-boundary.rule.md
- timestamp-soft-delete.rule.md
- zod-validation.rule.md
- any additional *.rule.md

Rules are authoritative over implementation.

---

### 2. Build Rule Expectations

Infer constraints including (but not limited to):

- router must not access models
- service owns business logic
- timestamps controlled by service
- soft delete enforced
- queries exclude invalid records
- validation exists per endpoint
- business uniqueness constraints enforced
- mongoose models contain persistence only

---

### 3. Detect Violations

For EACH violation output:

- rule name
- file path
- line or code pattern
- violation description
- expected behavior
- severity level

Severity levels:

CRITICAL — breaks architecture invariant  
MAJOR — violates layer responsibility  
MINOR — style or consistency issue

---

### 4. Business Uniqueness Detection (IMPORTANT)

If a field is used as an external identifier (e.g. alias, slug, key):

Audit whether services enforce uniqueness using:

{ isInvalid: { $ne: true }, field: value }

Check BOTH:

- create()
- update()

Missing guard = MAJOR violation.

---

### 5. Soft Delete Enforcement

Verify:

All read queries include:

{ isInvalid: { $ne: true } }

Missing filter = CRITICAL.

---

### 6. Timestamp Ownership

Verify:

Router ❌ sets timestamps  
Service ✅ updates timestamps  
Client ❌ controls timestamps

Violations = CRITICAL.

---

## Output Format (STRICT)

Return ONLY the report.

No explanations.
No suggestions outside report.

---

# REPORT FORMAT

## Rule Audit Report

### Summary

- Files scanned: X
- Violations found: X
- Critical: X
- Major: X
- Minor: X

---

### Violations

#### [CRITICAL] timestamp-soft-delete.rule.md

File: src/services/entryService.ts:42

Issue:
Query missing soft-delete filter.

Found:
Entry.findById(id)

Expected:
Entry.findOne({ _id: id, isInvalid: { $ne: true } })

---

#### [MAJOR] service-boundary.rule.md

File: src/routes/entryRouter.ts:88

Issue:
Router contains business logic.

...

---

### Passed Checks

- router-layer separation ✅
- zod validation present ✅
- mongoose models persistence-only ✅

---

END OF REPORT

