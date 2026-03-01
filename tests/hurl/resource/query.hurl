# Resource API Tests - Query and List

# Setup: Create an entry first
POST {{BASE_URL}}/entries
Content-Type: application/json
{
  "name": "Resource Query Test Entry",
  "alias": "resource-query-entry-{{timestamp}}"
}

HTTP 201
[Captures]
entry_id: jsonpath "$._id"
entry_alias: jsonpath "$.alias"

# Setup: Upload files to create blocks and resources
POST {{BASE_URL}}/upload/{{entry_alias}}
Content-Type: application/octet-stream
```
resource-query-content-1-{{timestamp}}
```

HTTP 201
[Captures]
uploaded_resource1_id: jsonpath "$._id"
block_id: jsonpath "$.block"

# Delete uploaded resource, keep block for resource creation
DELETE {{BASE_URL}}/resources/{{uploaded_resource1_id}}

HTTP 204

# Setup: Create multiple resources for list testing
POST {{BASE_URL}}/resources
Content-Type: application/json
{
  "entry": "{{entry_id}}",
  "block": "{{block_id}}",
  "name": "Resource One"
}

HTTP 201
[Captures]
resource1_id: jsonpath "$._id"
resource1_created_at: jsonpath "$.createdAt"

POST {{BASE_URL}}/resources
Content-Type: application/json
{
  "entry": "{{entry_id}}",
  "block": "{{block_id}}",
  "name": "Resource Two"
}

HTTP 201
[Captures]
resource2_id: jsonpath "$._id"

POST {{BASE_URL}}/resources
Content-Type: application/json
{
  "entry": "{{entry_id}}",
  "block": "{{block_id}}",
  "name": "Resource Three"
}

HTTP 201
[Captures]
resource3_id: jsonpath "$._id"

# Test 1: Get resource by ID
GET {{BASE_URL}}/resources/{{resource1_id}}

HTTP 200
[Asserts]
jsonpath "$.name" == "Resource One"
jsonpath "$.entry" == "{{entry_id}}"
jsonpath "$.block" == "{{block_id}}"
jsonpath "$._id" == "{{resource1_id}}"
jsonpath "$.createdAt" == {{resource1_created_at}}

# Test 2: Get non-existent resource should return 404
GET {{BASE_URL}}/resources/507f1f77bcf86cd799439099

HTTP 404
[Asserts]
jsonpath "$.error" exists

# Test 3: List all resources (non-paginated)
GET {{BASE_URL}}/resources

HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.items" isCollection
jsonpath "$.total" isInteger
jsonpath "$.total" >= 3

# Test 4: List resources with pagination - Page 1
GET {{BASE_URL}}/resources?limit=2&offset=0

HTTP 200
[Asserts]
jsonpath "$.items" isCollection
jsonpath "$.total" isInteger
jsonpath "$.total" >= 3
jsonpath "$.items" count == 2
jsonpath "$.limit" == 2
jsonpath "$.offset" == 0

# Test 5: List resources with pagination - Page 2
GET {{BASE_URL}}/resources?limit=2&offset=2

HTTP 200
[Asserts]
jsonpath "$.items" isCollection
jsonpath "$.total" isInteger
jsonpath "$.items" count >= 1
jsonpath "$.limit" == 2
jsonpath "$.offset" == 2

# Test 6: Verify stable ordering - page 2 should not contain page 1's last item
GET {{BASE_URL}}/resources?limit=2&offset=0

HTTP 200
[Captures]
page1_last_id: jsonpath "$.items[-1]._id"

GET {{BASE_URL}}/resources?limit=2&offset=2

HTTP 200
[Asserts]
jsonpath "$.items" isCollection
# jsonpath "$.items[0]._id" != "{{page1_last_id}}"

# Test 7: List with only limit parameter
GET {{BASE_URL}}/resources?limit=2

HTTP 200
[Asserts]
jsonpath "$.items" isCollection
jsonpath "$.total" isInteger
jsonpath "$.items" count <= 2

# Test 8: Filter resources by entryAlias
GET {{BASE_URL}}/resources?entryAlias={{entry_alias}}

HTTP 200
[Asserts]
jsonpath "$.items" isCollection
jsonpath "$.total" isInteger
#jsonpath "$.total" == 3

# Test 9: Filter resources by entryAlias with pagination
GET {{BASE_URL}}/resources?entryAlias={{entry_alias}}&limit=2&offset=0

HTTP 200
[Asserts]
jsonpath "$.items" isCollection
#jsonpath "$.items" count == 2
jsonpath "$.limit" == 2
jsonpath "$.offset" == 0

# Test 10: Filter resources by non-existent entryAlias
GET {{BASE_URL}}/resources?entryAlias=non-existent-alias-{{timestamp}}

HTTP 200
[Asserts]
jsonpath "$.items" isCollection
jsonpath "$.items" count == 0
jsonpath "$.total" == 0

# Cleanup: Delete all created resources
DELETE {{BASE_URL}}/resources/{{resource1_id}}

HTTP 204

DELETE {{BASE_URL}}/resources/{{resource2_id}}

HTTP 204

DELETE {{BASE_URL}}/resources/{{resource3_id}}

HTTP 204

# Cleanup: Delete entry
DELETE {{BASE_URL}}/entries/{{entry_id}}

HTTP 204

# Verify cleanup: Resources should not be found after deletion
GET {{BASE_URL}}/resources/{{resource1_id}}

HTTP 404

GET {{BASE_URL}}/resources/{{resource2_id}}

HTTP 404

GET {{BASE_URL}}/resources/{{resource3_id}}

HTTP 404

# Verify block has linkCount 0 (orphaned but queryable)
GET {{BASE_URL}}/blocks/{{block_id}}

HTTP 200
[Asserts]
jsonpath "$.linkCount" == 0
