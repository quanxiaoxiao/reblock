# Generate Hurl Tests From OpenAPI

Synchronize Hurl tests with the OpenAPI contract.

Load rules:

.opencode/rules/api-contract-enforcement.rule.md
.opencode/rules/hurl-generation.rule.md
.opencode/rules/test-data-lifecycle.rule.md
.opencode/rules/dataset-seeding.rule.md
.opencode/rules/hurl.rule.md

---

## Tasks

1. Read openapi.json
2. Detect all endpoints grouped by tag
3. Locate tests/hurl/{tag}
4. Generate or update:

- create.hurl
- query.hurl
- update.hurl
- remove.hurl

5. Detect paginated endpoints
6. Inject pagination tests
7. Inject total assertions
8. Inject stable ordering verification

---

## Constraints

- minimal diff
- never overwrite manual tests
- append missing scenarios only

---

## Output

Return ONLY modified files.

