# Resource API Tests - Block Switch / History / Rollback

# Setup: create entry
POST {{BASE_URL}}/entries
Content-Type: application/json
{
  "name": "Resource Block History Test",
  "alias": "resource-block-history-{{timestamp}}"
}

HTTP 201
[Captures]
entry_id: jsonpath "$._id"
entry_alias: jsonpath "$.alias"

# Setup: upload first file (block A)
POST {{BASE_URL}}/upload/{{entry_alias}}
Content-Type: application/octet-stream
```
block-history-a-{{timestamp}}
```

HTTP 201
[Captures]
resource_a_id: jsonpath "$._id"
block_a_id: jsonpath "$.block"

# Setup: upload second file (block B)
POST {{BASE_URL}}/upload/{{entry_alias}}
Content-Type: application/octet-stream
```
block-history-b-{{timestamp}}
```

HTTP 201
[Captures]
resource_b_id: jsonpath "$._id"
block_b_id: jsonpath "$.block"

# Create target resource bound to block A
POST {{BASE_URL}}/resources
Content-Type: application/json
{
  "entry": "{{entry_id}}",
  "block": "{{block_a_id}}",
  "name": "history-target"
}

HTTP 201
[Captures]
resource_id: jsonpath "$._id"
updated_at_before_swap: jsonpath "$.updatedAt"

# Switch resource block: A -> B (resource id unchanged)
PATCH {{BASE_URL}}/resources/{{resource_id}}/block
Content-Type: application/json
{
  "newBlockId": "{{block_b_id}}",
  "changedBy": "hurl-test",
  "reason": "switch for history test",
  "requestId": "hurl-swap-{{timestamp}}",
  "expectedUpdatedAt": {{updated_at_before_swap}}
}

HTTP 200
[Asserts]
jsonpath "$._id" == "{{resource_id}}"
jsonpath "$.block" == "{{block_b_id}}"

# Query history and capture swap record
GET {{BASE_URL}}/resources/{{resource_id}}/history?limit=20&offset=0

HTTP 200
[Captures]
history_id: jsonpath "$.items[0]._id"
[Asserts]
jsonpath "$.total" >= 1
jsonpath "$.items[0].action" == "swap"
jsonpath "$.items[0].fromBlockId" == "{{block_a_id}}"
jsonpath "$.items[0].toBlockId" == "{{block_b_id}}"

# Rollback using history record: B -> A
POST {{BASE_URL}}/resources/{{resource_id}}/rollback
Content-Type: application/json
{
  "historyId": "{{history_id}}",
  "changedBy": "hurl-test",
  "requestId": "hurl-rollback-{{timestamp}}"
}

HTTP 200
[Asserts]
jsonpath "$._id" == "{{resource_id}}"
jsonpath "$.block" == "{{block_a_id}}"

# History should now include rollback action
GET {{BASE_URL}}/resources/{{resource_id}}/history?limit=20&offset=0

HTTP 200
[Asserts]
jsonpath "$.total" >= 2
jsonpath "$.items[0].action" == "rollback"

# Trigger a failed block switch to verify /errors correlation (logged by service)
PATCH {{BASE_URL}}/resources/{{resource_id}}/block
Content-Type: application/json
{
  "newBlockId": "507f1f77bcf86cd799439099",
  "changedBy": "hurl-test",
  "reason": "expect missing block"
}

HTTP 404
[Asserts]
jsonpath "$.code" == "NEW_BLOCK_NOT_FOUND"

# The failed switch should be discoverable via /errors filter
GET {{BASE_URL}}/errors?days=1&status=open&path=/resources/{{resource_id}}/block
x-errors-token: {{ERRORS_TOKEN}}

HTTP 200
[Asserts]
jsonpath "$.total" >= 1

# Cleanup: delete test resources and entry
DELETE {{BASE_URL}}/resources/{{resource_id}}
HTTP 204

DELETE {{BASE_URL}}/resources/{{resource_a_id}}
HTTP 204

DELETE {{BASE_URL}}/resources/{{resource_b_id}}
HTTP 204

DELETE {{BASE_URL}}/entries/{{entry_id}}
HTTP 204
