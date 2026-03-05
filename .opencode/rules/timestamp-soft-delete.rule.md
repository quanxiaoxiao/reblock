# Timestamp & Soft Delete Rule (MANDATORY)

This project enforces **strict timestamp consistency** and **soft delete only** policy.

This rule overrides any default mongoose behavior.

---

# 1. Timestamp Standard (GLOBAL)

ALL time fields MUST use:

✅ Unix timestamp (number)
✅ milliseconds precision
✅ generated via `Date.now()`

Forbidden:

❌ Date type (exception: TTL fields, see below)
❌ ISO string
❌ mongoose timestamps option
❌ mixed formats

**Exception — TTL fields:**
MongoDB TTL indexes ONLY work on `Date` type fields. Therefore, fields used for TTL
automatic cleanup (e.g., `expiresAt` on LogEntry) **MUST** use `type: Date`.
This is the only permitted use of `Date` type in the codebase.

Example:

```ts
createdAt: { type: Number, default: Date.now }
updatedAt: { type: Number, default: Date.now }
````

---

# 2. Required Timestamp Fields

Every persistent entity MUST include:

| Field     | Required | Description            |
| --------- | -------- | ---------------------- |
| createdAt | ✅        | creation time          |
| updatedAt | ✅        | last modification time |

Optional:

| Field          | Description          |
| -------------- | -------------------- |
| lastAccessedAt | read/access tracking |
| invalidatedAt  | soft delete time     |

---

# 3. Ownership of Time Fields

Timestamp ownership is STRICT:

Layer responsibility:

| Layer   | Responsibility         |
| ------- | ---------------------- |
| Router  | ❌ NEVER set timestamps |
| Schema  | ✅ default only         |
| Service | ✅ controls updates     |
| Model   | ❌ no logic             |

---

# 4. Update Rules (CRITICAL)

## createdAt is IMMUTABLE

During update operations:

MUST NOT update:

* createdAt
* invalidatedAt (unless deleting)

Forbidden example:

```ts
Model.updateOne(id, body) // ❌ unsafe
```

Required pattern:

```ts
Model.updateOne(
  { _id: id },
  {
    ...safeData,
    updatedAt: Date.now(),
  }
)
```

---

## Update Sanitization (MANDATORY)

Service layer MUST remove time fields from user input:

```ts
delete data.createdAt;
delete data.updatedAt;
delete data.invalidatedAt;
```

User input MUST NEVER control timestamps.

---

# 5. Soft Delete Policy (GLOBAL)

Physical deletion is FORBIDDEN.

Forbidden:

```ts
deleteOne()
findByIdAndDelete()
remove()
```

---

## Soft Delete Implementation

Delete MUST become:

```ts
{
  isInvalid: true,
  invalidatedAt: Date.now()
}
```

Example:

```ts
await Model.updateOne(
  { _id: id },
  {
    isInvalid: true,
    invalidatedAt: Date.now(),
    updatedAt: Date.now(),
  }
);
```

---

# 6. Query Rules

All read queries MUST exclude invalid records by default:

```ts
{ isInvalid: { $ne: true } }
```

Allowed override ONLY when explicitly required.

### Pagination Guidance

* When returning multiple records (e.g., list endpoints), services MUST support:

  * `limit`: number of items
  * `offset`: 0-based starting index
* Pagination MUST be applied after filtering invalid records.
* Service MUST ensure deterministic ordering (e.g., by `createdAt`) for stable pagination.

### Pagination Count Consistency

When pagination is enabled:

- Service MUST compute total count using:
  Model.countDocuments(query)

- Query used for count MUST include:
  { isInvalid: { $ne: true } }

Example:

const query = {
  ...filter,
  isInvalid: { $ne: true }
};

const [items, total] = await Promise.all([
  Model.find(query)
    .sort({ createdAt: -1 })
    .skip(offset)
    .limit(limit),
  Model.countDocuments(query),
]);

Total count represents ALL matching records
before pagination.

### Stable Pagination Ordering (MANDATORY)

Offset-based pagination REQUIRES deterministic ordering.

When pagination is applied (`limit` or `offset` present):

Service MUST apply a stable sort order.

Required:

- Sorting MUST be explicit.
- Sorting field MUST be immutable or monotonic.

Recommended default:

.sort({ createdAt: -1, _id: -1 })

Reason:

- createdAt provides chronological order
- _id guarantees tie-break stability

Forbidden:

❌ pagination without sort
❌ sorting by mutable fields (name, title, status)
❌ relying on MongoDB natural order

Violation Severity: CRITICAL


---

# 7. Create Rules

Create operation MUST:

```ts
{
  createdAt: Date.now(),
  updatedAt: Date.now()
}
```

Service layer injects timestamps.

---

# 8. API Contract Constraints

Zod schemas MUST NOT allow clients to send:

* createdAt
* updatedAt
* invalidatedAt

These fields are server-controlled.

---

# 9. OpenCode Validation Checklist

OpenCode MUST report violation if:

* Date type timestamp detected (exception: TTL fields like `expiresAt`)
* mongoose timestamps enabled
* deleteOne/remove used
* createdAt modified in update
* timestamps accepted from request body
* query missing soft-delete filter

---

# 10. Design Principle

Time is **system truth**, never client data.

Rules:

* timestamps are deterministic
* deletion is reversible
* audit trail is preserved
* services control lifecycle

