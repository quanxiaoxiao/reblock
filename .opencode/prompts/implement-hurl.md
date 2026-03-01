# Implement Hurl Prompt

You are tasked with implementing the system based on Hurl test specifications.

## Task
Implement the system so that all Hurl files under `tests/hurl/{{entry}}` pass successfully.

## Hard Constraints
1. **Strict Compliance**: You MUST strictly follow all rules defined in `.opencode/` (Architecture, Boundaries, MongoDB Rules, etc.).
2. **Layered Implementation**: 
   - Prefer adding business rules in **Domain**.
   - Define use-cases in **Application**.
   - **Infrastructure** must handle the MongoDB soft-delete and audit fields.
3. **No Shortcuts**: Do not place business logic in Transport (Controllers). 
4. **Validation**: Ensure all input validation matches the Hurl expected status codes.

## Input Variable
- entry: {{entry}}

## Business Constraints

You MUST enforce business uniqueness rules defined in:

business-uniqueness.rule.md

If a unique field exists:

- add Hurl tests validating conflict behavior
- ensure duplicate create returns 409
- ensure duplicate update returns 409
- ensure soft-deleted records do NOT block reuse

