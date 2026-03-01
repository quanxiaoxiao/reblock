# Upload API Tests - Deduplication

# Setup: Create an entry with unique alias
POST {{BASE_URL}}/entries
Content-Type: application/json
{
  "name": "Dedupe Test Entry",
  "alias": "dedupe-test-{{timestamp}}"
}

HTTP 201
[Captures]
entry_id: jsonpath "$._id"
entry_alias: jsonpath "$.alias"

# First upload - creates new block with unique content
POST {{BASE_URL}}/upload/{{entry_alias}}
Content-Type: application/octet-stream
```
dedupe content {{timestamp}}
```

HTTP 201
[Captures]
resource_id: jsonpath "$._id"
block_id: jsonpath "$.block"

# Verify block has linkCount=1
GET {{BASE_URL}}/blocks/{{block_id}}

HTTP 200
[Asserts]
jsonpath "$.linkCount" == 1

################################################################################
# Test: Second upload of same content should reuse block and increment linkCount
################################################################################

POST {{BASE_URL}}/upload/{{entry_alias}}
Content-Type: application/octet-stream
```
dedupe content {{timestamp}}
```

HTTP 201
[Asserts]
jsonpath "$.block" == "{{block_id}}"

# Verify block linkCount was incremented to 2
GET {{BASE_URL}}/blocks/{{block_id}}

HTTP 200
[Asserts]
jsonpath "$.linkCount" == 2

################################################################################
# Cleanup
################################################################################

DELETE {{BASE_URL}}/resources/{{resource_id}}

HTTP 204

DELETE {{BASE_URL}}/entries/{{entry_id}}

HTTP 204
