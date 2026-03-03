---
## ⚠️ Migration Notice

This file has been moved from the original location as part of the .opencode restructuring.

**Original Location:** rules/hono-layer.rule.md
**New Location:** implementations/typescript/framework/ts-hono-layer.rule.md

For language-agnostic specifications, please refer to the files in the root directories:
- rules/ (language-agnostic core rules)
- docs/ (language-agnostic documentation)
- checklists/ (language-agnostic checklists)
- plans/ (language-agnostic plans)
- test/ (language-agnostic test rules)
---

# Hono Router Rule (TypeScript Specific)

Router responsibilities:

- HTTP mapping
- validation middleware
- status codes
- response formatting

Router MUST:

- use validate()
- return JSON response
- handle 404 cases

Router MUST NOT:

- contain business logic
- access database
