# Rule: Test Data Lifecycle (Hurl)

This rule defines how test data MUST be created,
shared, and destroyed across Hurl tests.

Applies to:

tests/hurl/**

Violation Severity: CRITICAL

---

# 1. Design Goal

Hurl tests MUST be:

- deterministic
- repeatable
- isolated
- self-cleaning

Tests MUST NOT depend on pre-existing database state.

---

# 2. Lifecycle Model

Every test resource follows:

CREATE → USE → CLEANUP → VERIFY REMOVAL

Cleanup is MANDATORY.

---

# 3. Data Ownership

Each Hurl file owns the data it creates.

Example:

tests/hurl/entry/create.hurl

owns all entries created inside the file.

Other files MUST NOT rely on them.

Forbidden:

❌ assuming data created by another test
❌ global shared fixtures

---

# 4. Resource Creation Rule

When a test creates a resource:

It MUST capture its identifier.

Example:

POST /entries

[Captures]
entry_id: jsonpath "$._id"

---

# 5. Cross-Request Usage

Captured identifiers MUST be reused:

GET /entries/{{entry_id}}

DELETE /entries/{{entry_id}}

Hardcoding IDs is FORBIDDEN.

---

# 6. Cleanup Requirement (MANDATORY)

Every created resource MUST be deleted.

Example:

DELETE /entries/{{entry_id}}

HTTP 200

---

# 7. Final Verification (CRITICAL)

After cleanup, test MUST verify removal:

GET /entries/{{entry_id}}

HTTP 404

This ensures:

- soft delete works
- transport contract honored

---

# 8. Soft Delete Awareness

Even if database uses soft-delete:

Transport layer MUST behave as:

deleted resource → 404

Hurl validates external behavior, not persistence.

---

# 9. Pagination Isolation

Pagination tests MUST create their own dataset.

Example:

create ≥ 3 resources
then paginate.

Forbidden:

❌ relying on unknown existing records.

---

# 10. Stable Dataset Requirement

Pagination tests MUST:

- create deterministic order
- avoid timestamp collisions when possible

Recommended:

create sequential resources before pagination test.

---

# 11. Test Independence

Each file MUST be runnable independently:

```bash
hurl tests/hurl/entry/query.hurl
````

must succeed alone.

---

# 12. Cleanup Ordering

Cleanup MUST occur:

* at end of file
* reverse order of creation (recommended)

---

# 13. Failure Safety

Cleanup MUST still execute logically even if
intermediate assertions fail.

OpenCode SHOULD group cleanup at end.

---

# 14. OpenCode Responsibilities

OpenCode MUST:

* detect POST requests
* auto-add capture blocks
* append cleanup DELETE
* append final 404 verification
* prevent ID hardcoding
* ensure pagination datasets created locally

---

# 15. Auto-Repair Behavior

If lifecycle missing, OpenCode MUST:

* inject captures
* inject cleanup
* inject 404 verification

Minimal diff required.

