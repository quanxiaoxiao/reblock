# Architecture Rule — Resource Service API

All modules MUST follow timestamp-soft-delete.rule.md.

The project follows strict layered architecture:

routes → schemas → services → models

Rules:

1. Router MUST NOT access mongoose models directly
2. Router MUST call services only
3. Validation MUST happen before service call
4. Services own business logic
5. Models contain persistence only
6. Zod schemas define API contract

Violation examples:

❌ router importing models
❌ service reading request context
❌ validation inside service
