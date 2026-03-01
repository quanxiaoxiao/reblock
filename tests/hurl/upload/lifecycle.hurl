# Upload API Tests - Lifecycle (linkCount management)

# Setup: Create an entry with unique alias
POST {{BASE_URL}}/entries
Content-Type: application/json
{
  "name": "Lifecycle Test Entry",
  "alias": "lifecycle-test-{{timestamp}}"
}

HTTP 201
[Captures]
entry_id: jsonpath "$._id"
entry_alias: jsonpath "$.alias"

# Upload first resource with unique content
POST {{BASE_URL}}/upload/{{entry_alias}}
Content-Type: application/octet-stream
```
lifecycle content {{timestamp}} first
```

HTTP 201
[Captures]
resource_id_1: jsonpath "$._id"
block_id: jsonpath "$.block"

# Upload second resource (same content - dedupe)
POST {{BASE_URL}}/upload/{{entry_alias}}
Content-Type: application/octet-stream
```
lifecycle content {{timestamp}} first
```

HTTP 201
[Captures]
resource_id_2: jsonpath "$._id"

# Verify block linkCount is now 2
GET {{BASE_URL}}/blocks/{{block_id}}

HTTP 200
[Asserts]
jsonpath "$.linkCount" == 2

################################################################################
# Test: Delete first resource should decrement linkCount
################################################################################

DELETE {{BASE_URL}}/resources/{{resource_id_1}}

HTTP 204

# Verify block linkCount is now 1
GET {{BASE_URL}}/blocks/{{block_id}}

HTTP 200
[Asserts]
jsonpath "$.linkCount" == 1

################################################################################
# Test: Delete second resource should set linkCount to 0
################################################################################

DELETE {{BASE_URL}}/resources/{{resource_id_2}}

HTTP 204

# Verify block linkCount is now 0
GET {{BASE_URL}}/blocks/{{block_id}}

HTTP 200
[Asserts]
jsonpath "$.linkCount" == 0

################################################################################
# Cleanup
################################################################################

DELETE {{BASE_URL}}/entries/{{entry_id}}

HTTP 204
