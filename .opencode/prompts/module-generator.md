# Module Generator

Generate a new resource module following existing architecture.

MUST comply with timestamp-soft-delete.rule.md.

Create:

- mongoose model
- zod schemas
- service
- hono router

Follow patterns from:

- block
- entry
- resource

Requirements:

1. CRUD endpoints
2. validation middleware
3. service abstraction
4. timestamp handling

Output files:

models/
schemas/
services/
routes/

DO NOT modify unrelated files.

