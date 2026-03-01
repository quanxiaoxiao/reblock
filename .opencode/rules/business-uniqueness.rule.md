# Business Uniqueness Rule (MANDATORY)

Some fields require **logical uniqueness** across
non-invalid records.

This is NOT a database constraint.
This is a SERVICE LAYER invariant.

---

## Definition

A field is business-unique when:

Only ONE record may exist matching:

{
  isInvalid: { $ne: true },
  <field>: value
}

---

## Entry Module Rule

Field:

alias

Constraint:

alias MUST be unique among active entries.

Equivalent query:

{
  isInvalid: { $ne: true },
  alias: value
}

---

## Enforcement Layer

MUST be enforced in:

✅ service.create()
✅ service.update()

MUST NOT be enforced in:

❌ router
❌ mongoose schema validation

---

## Create Rule

Before create:

Service MUST check existence:

findOne({
  alias,
  isInvalid: { $ne: true }
})

If exists:

THROW business error:

409 Conflict

---

## Update Rule

When updating alias:

Service MUST check:

findOne({
  _id: { $ne: currentId },
  alias,
  isInvalid: { $ne: true }
})

If exists → reject.

---

## Error Contract

Response:

{
  "error": "alias already exists"
}

HTTP Status:

409

---

## OpenCode Responsibility

OpenCode MUST:

- detect business-unique fields
- inject conflict check into services
- never rely on mongoose unique index


# Business Uniqueness Rule

Certain fields act as external identifiers.

These fields MUST be unique among non-invalid records.

Example:

Entry.alias

Uniqueness scope:

{ isInvalid: { $ne: true }, alias }

---

## Enforcement

Services MUST reject create/update when conflict exists.

---

## API Behavior (MANDATORY)

When uniqueness conflict occurs:

HTTP Status: 409 Conflict

Response:

{
  "error": "alias already exists"
}

---

## Hurl Requirement (CRITICAL)

Each unique field MUST have Hurl tests:

1. create duplicate → 409
2. update duplicate → 409
3. soft-deleted record DOES NOT block reuse

