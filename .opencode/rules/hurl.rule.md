# Hurl Integration Rules

Hurl files define **external behavior contracts only**.

## File Organization
To ensure clarity and modularity, **each business operation MUST be stored in a separate file**. 
Do NOT combine multiple operations (e.g., Create and Delete) into a single Hurl file.

Naming convention for files in the resource directory:
- `create.hurl`: Resource creation
- `remove.hurl`: Soft delete or removal operations
- `query.hurl`: Search, list, or detail retrieval
- `update.hurl`: Modification of existing resources
- `[action].hurl`: Specific business actions (e.g., `reorder.hurl`, `move.hurl`)

## Hurl Responsibilities
- Define endpoints and HTTP methods
- Define expected status codes
- Define response payload shape
- Define error scenarios

## Mandatory Lifecycle & Cleanup
To ensure test isolation and environment hygiene, all tests that generate data MUST follow the "Clean-as-you-go" principle:
1.  **Mandatory Cleanup**: Any resource created during a test (e.g., via `POST`) must be deleted using the corresponding `DELETE` or removal endpoint before the test script ends.
2.  **404 Final Verification**: After the deletion, the test MUST perform a final `GET` request to the resource URI and assert that the response status is **404 Not Found**.
    - **Logic**: Even with soft-delete (as per `mongodb.rules.md`), the Transport layer must return a 404 for deleted resources to satisfy the external contract.

## Forbidden Assumptions
Hurl tests MUST NOT:
- assume internal architecture
- assume database structure
- assume service or module names
- encode implementation shortcuts

## Priority Rule
Hurl tests MUST pass,
but NEVER at the cost of violating `.opencode` rules.

