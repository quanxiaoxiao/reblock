# Rule: Dataset Seeding for Hurl Tests

Defines how deterministic datasets MUST be created
for Hurl-based API testing.

Applies to:

tests/hurl/**

Violation Severity: CRITICAL

---

# 1. Purpose

Tests MUST generate their own datasets when:

- pagination is tested
- sorting is validated
- filtering behavior is verified
- total count assertions exist

Tests MUST NOT rely on unknown database state.

---

# 2. Dataset Definition

A dataset is:

A controlled set of resources created during a test
for later verification.

Lifecycle:

SEED → VERIFY → CLEANUP

---

# 3. Mandatory Seeding Conditions

OpenCode MUST generate dataset seeding when:

- endpoint supports pagination (limit/offset)
- response includes `total`
- stable ordering is required
- query returns multiple records

---

# 4. Minimum Dataset Size

Pagination tests MUST create:

minimum = (limit × 2) + 1

Example:

limit = 2  
dataset ≥ 5 records

Reason:

Ensures page boundaries are validated.

---

# 5. Deterministic Ordering Requirement

Seeded data MUST produce deterministic ordering.

Preferred ordering key:

createdAt ASC

If API defines another default sort,
dataset MUST respect it.

---

# 6. Sequential Creation Rule

Resources MUST be created sequentially.

Example:

POST /entries
alias: seed-001

POST /entries
alias: seed-002

POST /entries
alias: seed-003

Sequential creation guarantees timestamp ordering.

---

# 7. Unique Field Safety

If resource contains business-unique fields
(e.g. alias):

OpenCode MUST generate unique values.

Pattern:

seed-{index}-{random}

Example:

seed-001-a8f3
seed-002-a8f3

Hardcoded duplicates are FORBIDDEN.

---

# 8. Capture Strategy

Each seeded resource MUST capture its ID.

Example:

[Captures]
id_1: jsonpath "$._id"

IDs MUST be reused later for cleanup.

---

# 9. Pagination Validation Dataset

Generated pagination tests MUST:

1. seed dataset
2. request page 1
3. request page 2
4. compare boundaries
5. assert total count

---

# 10. Total Count Assertion (MANDATORY)

After seeding N records:

Tests MUST assert:

jsonpath "$.total" == N

Failure to assert total = CRITICAL violation.

---

# 11. Dataset Isolation

Datasets MUST be local to the Hurl file.

Forbidden:

❌ shared seed files
❌ global fixtures
❌ cross-module reuse

---

# 12. Cleanup Requirement

All seeded resources MUST be deleted.

Cleanup MUST:

- delete ALL seeded IDs
- verify 404 after deletion

---

# 13. Naming Convention

Seed identifiers SHOULD follow:

seed-{module}-{index}

Example:

seed-entry-001
seed-entry-002

---

# 14. OpenCode Responsibilities

OpenCode MUST automatically:

- detect paginated endpoints
- inject dataset seeding
- generate unique payloads
- capture all IDs
- assert total
- append cleanup block

---

# 15. Auto-Repair Behavior

If pagination exists but dataset missing:

OpenCode MUST:

- inject seeding requests
- inject total assertions
- inject cleanup

Minimal diff required.

---

# 16. Anti-Patterns (FORBIDDEN)

❌ relying on existing DB rows  
❌ assuming total > 0  
❌ using fixed IDs  
❌ pagination tests without seeding  
❌ unstable dataset ordering

---

# 17. Design Principle

Tests define their own universe.

Database state before test execution
MUST NOT affect results.

