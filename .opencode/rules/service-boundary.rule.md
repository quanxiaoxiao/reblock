# Service Boundary Rule

Service layer responsibilities:

- business logic
- timestamps
- orchestration
- querying

Service MUST:

- return plain model result
- never access Hono Context

Service API:

create(data)
update(id, data)
getById(id)
list(filter?, limit?, offset?)  # added pagination: offset starts at 0
delete(id)

## Pagination Rule

- All `list` operations MUST support optional pagination parameters:
  - `limit`: number of items per page
  - `offset`: starting index, **0-based**
- If no pagination parameters are provided, the service may return all matching items.
- Pagination MUST NOT skip or duplicate records.

## Stable Ordering Rule (Pagination)

When list() applies pagination:

Service MUST enforce deterministic ordering.

Default ordering:

createdAt DESC
_id DESC (tie-breaker)

Example:

Model.find(query)
  .sort({ createdAt: -1, _id: -1 })
  .skip(offset)
  .limit(limit)

Services MUST NOT expose unordered pagination.

---

## Pagination Result Rule (MANDATORY)

When pagination parameters are used (`limit` or `offset` provided),
the service MUST return the total count of matching records.

### Required Behavior

If pagination is applied:

Service response MUST be:

{
  items: T[],
  total: number,
  limit?: number,
  offset?: number
}

Definitions:

- `items`: paginated records
- `total`: total number of records matching filter
  (ignoring pagination)
- `offset`: 0-based index
- `limit`: page size

### Non-Pagination Case

If pagination parameters are NOT provided:

Service MAY return:

T[]

(total count NOT required)

### Counting Rules

- total MUST respect soft-delete filtering:
  { isInvalid: { $ne: true } }

- total MUST use the SAME filter as items query.

Forbidden:

❌ returning paginated items without total
❌ computing total from paginated result length
❌ inconsistent filters between count and query

