# Rule: API Contract Enforcement

The OpenAPI specification is the SINGLE SOURCE OF TRUTH
for all HTTP APIs.

File:

/openapi.json

All routers, services, and tests MUST conform to it.

Violation Severity: CRITICAL

---

## 1. Contract Authority

OpenAPI schema defines:

- routes
- methods
- parameters
- request body
- response structure
- status codes

Implementation MUST NOT diverge from contract.

Forbidden:

❌ undocumented endpoints
❌ response fields not in schema
❌ missing required schema fields
❌ status codes not declared in OpenAPI

---

## 2. Router Compliance

Every HTTP route MUST:

- be defined using OpenAPI route builder
- expose schema via zod-openapi
- appear in openapi.json

Example (required pattern):

createRoute({
  method: 'get',
  path: '/resources',
  responses: {...}
})

Forbidden:

app.get('/resources', handler)   ❌

---

## 3. Response Enforcement

Handler responses MUST match declared schema.

Example:

Declared:

200 → ResourceListResponse

Actual response MUST conform exactly.

Rules:

- no additional properties
- required properties MUST exist
- nullable MUST match schema

OpenCode MUST refactor mismatches.

---

## 4. Pagination Contract Enforcement

If endpoint supports pagination:

OpenAPI schema MUST define:

query:
  limit
  offset

AND response MUST be:

{
  items: [],
  total: number,
  limit?: number,
  offset?: number
}

Violation cases:

❌ pagination params exist but no total
❌ total missing in schema
❌ schema mismatch with service return

---

## 5. Stable Ordering Contract

Paginated endpoints MUST document ordering.

OpenAPI description MUST include:

"default sort: createdAt desc, _id desc"

OpenCode MUST add description if missing.

---

## 6. Hurl Synchronization (MANDATORY)

For every OpenAPI tag:

A matching Hurl file MUST exist:

tests/hurl/{tag}.hurl

Rules:

- endpoints in OpenAPI MUST exist in hurl
- removed endpoints MUST be removed from hurl
- renamed paths MUST update hurl

OpenCode MUST regenerate hurl when contract changes.

---

## 7. Contract Drift Detection

OpenCode MUST detect:

### Case A — Code > Contract

Route exists but not in OpenAPI.

Action:
→ convert route to OpenAPI route.

### Case B — Contract > Code

Endpoint declared but handler missing.

Action:
→ generate stub handler.

### Case C — Schema Drift

Response shape differs.

Action:
→ refactor implementation.

---

## 8. Backward Compatibility

Breaking changes REQUIRE versioning.

Breaking change examples:

- removing field
- changing type
- removing endpoint
- changing status code

Required action:

/v2 path OR new tag version.

Forbidden:

silent breaking change.

---

## 9. CI Enforcement Model

Contract validation MUST pass before merge.

Validation includes:

1. openapi generation success
2. schema validation
3. hurl sync check
4. pagination compliance

---

## 10. OpenCode Responsibilities

OpenCode MUST be able to:

- regenerate OpenAPI
- diff contract vs implementation
- refactor routers
- regenerate hurl tests
- fix schema mismatches

OpenCode MUST prefer minimal diff refactors.

