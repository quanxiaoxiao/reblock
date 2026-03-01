# Resource API Tests - Remove (Soft Delete)

# Setup: Create an entry first
POST {{BASE_URL}}/entries
Content-Type: application/json
{
  "name": "Resource Delete Test Entry",
  "alias": "resource-delete-entry-{{timestamp}}"
}

HTTP 201
[Captures]
entry_id: jsonpath "$._id"
entry_alias: jsonpath "$.alias"

# Setup: Upload a file to create block
POST {{BASE_URL}}/upload/{{entry_alias}}
Content-Type: application/octet-stream
```
resource-delete-block-content-{{timestamp}}
```

HTTP 201
[Captures]
uploaded_resource_id: jsonpath "$._id"
block_id: jsonpath "$.block"

# Delete uploaded resource, keep block
DELETE {{BASE_URL}}/resources/{{uploaded_resource_id}}

HTTP 204

# Setup: Create a resource to delete
POST {{BASE_URL}}/resources
Content-Type: application/json
{
  "entry": "{{entry_id}}",
  "block": "{{block_id}}",
  "name": "Resource to Delete"
}

HTTP 201
[Captures]
resource_id: jsonpath "$._id"

# Test 1: Delete resource (soft delete)
DELETE {{BASE_URL}}/resources/{{resource_id}}

HTTP 204

# Test 2: Deleted resource should return 404
GET {{BASE_URL}}/resources/{{resource_id}}

HTTP 404
[Asserts]
jsonpath "$.error" exists

# Test 3: Delete non-existent resource should return 404
DELETE {{BASE_URL}}/resources/507f1f77bcf86cd799439099

HTTP 404
[Asserts]
jsonpath "$.error" exists

# Test 4: Create and delete multiple resources
POST {{BASE_URL}}/resources
Content-Type: application/json
{
  "entry": "{{entry_id}}",
  "block": "{{block_id}}",
  "name": "Resource A"
}

HTTP 201
[Captures]
resource_a_id: jsonpath "$._id"

POST {{BASE_URL}}/resources
Content-Type: application/json
{
  "entry": "{{entry_id}}",
  "block": "{{block_id}}",
  "name": "Resource B"
}

HTTP 201
[Captures]
resource_b_id: jsonpath "$._id"

# Delete Resource A
DELETE {{BASE_URL}}/resources/{{resource_a_id}}

HTTP 204

# Verify Resource A is gone
GET {{BASE_URL}}/resources/{{resource_a_id}}

HTTP 404

# Resource B should still exist
GET {{BASE_URL}}/resources/{{resource_b_id}}

HTTP 200
[Asserts]
jsonpath "$.name" == "Resource B"

# Cleanup: Delete Resource B
DELETE {{BASE_URL}}/resources/{{resource_b_id}}

HTTP 204

# Cleanup: Delete entry
DELETE {{BASE_URL}}/entries/{{entry_id}}

HTTP 204

# Final verification
GET {{BASE_URL}}/resources/{{resource_b_id}}

HTTP 404

GET {{BASE_URL}}/entries/{{entry_id}}

HTTP 404

# Verify block has linkCount 0 (orphaned but queryable)
GET {{BASE_URL}}/blocks/{{block_id}}

HTTP 200
[Asserts]
jsonpath "$.linkCount" == 0
