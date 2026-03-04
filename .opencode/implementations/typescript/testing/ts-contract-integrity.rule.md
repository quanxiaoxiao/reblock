# Contract Integrity Rule

**Rule ID**: ts-contract-integrity  
**Severity**: CRITICAL  

---

## Definition

Contract =

- OpenAPI
- Unit tests
- Hurl tests

These define external truth.

Implementation is replaceable.
Contract is NOT.

---

## Mandatory Guarantees

### 1. Status Codes

Must strictly follow OpenAPI definitions.

No extra status codes allowed.

---

### 2. Soft Delete Contract

Even if using soft-delete internally:

Transport layer MUST:

GET deleted resource → return 404

---

### 3. Pagination Contract

If endpoint supports limit/offset:

Response MUST include:

{
  items: [],
  total: number
}

Ordering MUST be deterministic.

---

### 4. Validation Contract

All validation MUST happen before service layer.

Invalid request MUST:

- return 400
- include validation error details

---

### 5. Timestamp Integrity

Implementation MUST NOT:

- allow client to set createdAt
- allow client to set updatedAt
- update createdAt on update

---

## Forbidden

❌ Changing contract to match implementation  
❌ Removing fields declared in OpenAPI  
❌ Returning additional undocumented fields  

---

## Contract Is Source of Truth

OpenCode MUST treat contract as immutable layer.
