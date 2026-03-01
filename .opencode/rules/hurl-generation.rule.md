# Rule: Hurl Generation from OpenAPI

Hurl tests are GENERATED FROM the OpenAPI contract.

OpenAPI is the source of truth.

File:
openapi.json

Violation Severity: CRITICAL

---

## 1. Directory Mapping

Each OpenAPI tag maps to:

tests/hurl/{tag}/

Example:

tag: entry
→ tests/hurl/entry/

---

## 2. Operation → File Mapping

Operation types map to filenames:

| HTTP Method | Operation Type | File |
|-------------|---------------|------|
| POST        | create        | create.hurl |
| GET (list)  | query         | query.hurl |
| GET (by id) | query         | query.hurl |
| PATCH/PUT   | update        | update.hurl |
| DELETE      | remove        | remove.hurl |

Multiple endpoints MAY exist in same file.

---

## 3. Pagination Detection

Endpoint is paginated when query includes:

- limit
- offset

---

## 4. Pagination Test Generation (MANDATORY)

Generated Hurl MUST include:

### Page 1

GET ?limit=2&offset=0

Assert:

jsonpath "$.items" exists
jsonpath "$.total" exists

---

### Page 2

GET ?limit=2&offset=2

Assert:

jsonpath "$.items" exists
jsonpath "$.total" exists

AND verify ordering stability.

---

## 5. Stable Ordering Verification

Offset pagination REQUIRES deterministic ordering.

Generated test MUST:

1. capture last item id from page1
2. assert page2 first item != captured id

Example:

[Captures]
last_id: jsonpath "$.items[-1]._id"

[Asserts]
jsonpath "$.items[0]._id" != "{{last_id}}"

---

## 6. Response Contract Enforcement

Generated asserts MUST verify:

- status code
- required fields
- pagination structure
- error responses declared in OpenAPI

Forbidden:

❌ asserting fields not in schema
❌ missing required asserts

---

## 7. Incremental Update Rule

OpenCode MUST:

- update existing files
- preserve manual tests
- append missing scenarios only

NEVER overwrite user-written tests.

---

## 8. Missing Test Detection

If OpenAPI endpoint exists but Hurl test missing:

OpenCode MUST generate it.

---

## 9. Deleted Endpoint Sync

If endpoint removed from OpenAPI:

OpenCode MUST remove obsolete test block.

---

## 10. Responsibility

OpenCode MUST be able to:

- parse OpenAPI
- detect pagination
- inject stable ordering tests
- sync files safely

