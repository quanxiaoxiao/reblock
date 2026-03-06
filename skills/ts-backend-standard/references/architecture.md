# Architecture

Use a strict layered backend shape:

`routes -> schemas -> services -> models`

Equivalent directory names are fine if responsibilities remain identical.

## Layer Responsibilities

Routes:

- map HTTP to service calls
- attach middleware
- select status codes
- format responses
- do not access models directly
- do not contain business logic

Schemas:

- define request and response contracts
- keep request validation close to the HTTP boundary
- avoid embedding business logic

Services:

- own business rules
- coordinate models and utilities
- accept plain typed inputs
- return plain typed outputs
- do not depend on Hono `Context`

Models:

- persistence only
- schema/index/query helpers only
- no HTTP concerns

Middleware:

- cross-cutting HTTP concerns only
- validation handoff
- auth
- error translation
- request logging or capture

## DRY Rule

If the same logic appears in 2 or more places, extract it.

Typical extraction targets:

- validation helpers
- pagination helpers
- error mapping
- stream or file helpers
- repeated route handler branches

Prefer:

- service extraction for business logic reuse
- utility extraction for framework-agnostic helpers
- middleware extraction for repeated HTTP concerns

## Pagination Rule

When list endpoints accept pagination:

- `offset` is 0-based
- ordering must be deterministic
- default ordering should be `createdAt DESC, _id DESC` or the repository's stable equivalent
- paginated responses should include total count

Avoid unordered pagination and avoid returning paginated items without the total.

## Portability Notes

- Do not force this exact folder tree onto an existing repository if its current naming differs.
- Instead, map current modules onto the same responsibilities and only rename or move files when the user explicitly wants structural normalization.
- Keep domain rules out of this layer guidance.
