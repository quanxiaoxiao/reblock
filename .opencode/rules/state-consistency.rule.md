## Purpose

Ensure **system state remains consistent, deterministic, and recoverable**
across API operations, database mutations, background jobs, and tests.

This rule prevents:

* partial writes
* invalid transitions
* race-condition corruption
* inconsistent reads
* orphaned data
* nondeterministic test failures

State consistency is a **hard invariant**, not a best practice.

---

## Core Principles

### 1. Single Source of Truth (SSOT)

Each piece of state MUST have exactly one authority.

| State Type        | Source of Truth                     |
| ----------------- | ----------------------------------- |
| resource metadata | database                            |
| derived counters  | computed or transactionally updated |
| cache             | database-backed                     |
| timestamps        | server-generated                    |
| test state        | seed system                         |

❌ Forbidden:

* multiple services writing same ownership field
* client-generated authoritative state

---

### 2. Atomic State Changes

All related mutations MUST succeed or fail together.

#### Required

* database transactions
* atomic updates
* rollback on failure

Example:

```
create resource
+ create block
+ increase linkCount
```

MUST be inside ONE transaction.

---

### 3. Valid State Transitions Only

Entities MUST follow explicit lifecycle transitions.

Example lifecycle:

```
created → active → invalidated
```

Forbidden transitions:

```
invalidated → active
deleted → updated
```

---

### Required Pattern

Each model SHOULD define:

```
allowedTransitions = {
  created: ['active', 'invalidated'],
  active: ['invalidated'],
  invalidated: []
}
```

State change MUST validate transition.

---

### 4. Soft Delete Consistency

Soft delete MUST behave as real deletion logically.

When:

```
isInvalid = true
```

System MUST:

* exclude from normal queries
* prevent updates
* prevent linking
* hide from listings

#### Required Query Rule

All reads MUST include:

```
{ isInvalid: { $ne: true } }
```

unless explicitly querying historical data.

---

### 5. Timestamp Integrity

State transitions MUST update timestamps consistently.

| Action     | Required Update       |
| ---------- | --------------------- |
| create     | createdAt + updatedAt |
| modify     | updatedAt             |
| invalidate | invalidatedAt         |

Forbidden:

* manual timestamp mutation
* client-provided timestamps
* updating createdAt

---

### 6. Read-After-Write Consistency

After mutation:

* immediate read MUST reflect latest state.

Required:

* await DB write completion
* avoid async fire-and-forget mutations

Forbidden:

```
save()
return success immediately
```

without awaiting persistence.

---

### 7. Derived State Synchronization

Derived values MUST remain synchronized.

Examples:

* linkCount
* usage counters
* aggregation totals

Allowed approaches:

✅ transactional update
✅ recompute-on-read
✅ event rebuild system

Forbidden:

❌ manual unsynchronized increments.

---

### 8. Idempotent Operations

All mutation APIs SHOULD be idempotent when possible.

Example:

```
DELETE /resource/:id
```

Calling multiple times MUST produce same final state.

---

### 9. Concurrency Safety

Concurrent requests MUST NOT corrupt state.

Required strategies:

* optimistic locking
* version fields
* atomic operators
* transactions

Example:

```
update where version = X
```

---

### 10. No Hidden Side Effects

API actions MUST NOT silently modify unrelated state.

Example violation:

```
GET /resource
→ modifies lastAccessTime
```

Reads MUST be side-effect free.

---

## Database Rules

### MUST

* use transactions for multi-document writes
* enforce schema validation
* use indexed ownership relations

### MUST NOT

* partially update related entities
* rely on application memory as state authority

---

## Test Consistency Requirements

Tests MUST guarantee:

* deterministic state
* isolated datasets
* clean teardown

Each test MUST:

```
seed → act → verify → cleanup
```

---

## Failure Handling

If a mutation fails midway:

System MUST:

* rollback transaction
  OR
* mark entity invalidated safely

Never leave half-written state.

---

## Observability

State mutations SHOULD log:

```
entity
previous state
next state
timestamp
actor
```

This enables debugging and replay.

---

## Enforcement Checklist

Before accepting generated code:

* [ ] State transition validated
* [ ] Transaction used where needed
* [ ] Soft delete respected
* [ ] Timestamps correct
* [ ] Reads exclude invalid data
* [ ] No partial updates
* [ ] Idempotency preserved
* [ ] Concurrent safety considered

---

## Anti-Patterns (Forbidden)

❌ Update multiple collections without transaction
❌ Client controls lifecycle state
❌ Manual counter sync scripts
❌ Queries missing soft-delete filter
❌ Async mutation without await
❌ Re-activating invalidated data

---

## Expected Outcome

Following this rule guarantees:

* deterministic APIs
* reproducible tests
* safe concurrency
* auditability
* recoverable failures
* long-term schema stability

State consistency is a **system invariant**, not optional behavior.

