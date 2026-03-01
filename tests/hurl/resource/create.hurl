# Resource API Tests - Create

# Setup: Create an entry first
POST {{BASE_URL}}/entries
Content-Type: application/json
{
  "name": "Resource Test Entry",
  "alias": "resource-test-entry-{{timestamp}}"
}

HTTP 201
[Captures]
entry_id: jsonpath "$._id"
entry_alias: jsonpath "$.alias"

# Setup: Upload a file to create block and resource
POST {{BASE_URL}}/upload/{{entry_alias}}
Content-Type: application/octet-stream
```
resource-test-content-{{timestamp}}
```

HTTP 201
[Captures]
uploaded_resource_id: jsonpath "$._id"
block_id: jsonpath "$.block"

# Cleanup uploaded resource first
DELETE {{BASE_URL}}/resources/{{uploaded_resource_id}}

HTTP 204

# Test 1: Create resource with minimal data
POST {{BASE_URL}}/resources
Content-Type: application/json
{
  "entry": "{{entry_id}}",
  "block": "{{block_id}}"
}

HTTP 201
[Captures]
resource_id: jsonpath "$._id"
[Asserts]
jsonpath "$.entry" == "{{entry_id}}"
jsonpath "$.block" == "{{block_id}}"
jsonpath "$.name" == ""
jsonpath "$.description" == ""
jsonpath "$.isInvalid" == false
jsonpath "$.createdAt" isInteger
jsonpath "$.updatedAt" isInteger
jsonpath "$._id" exists

# Test 2: Create resource with all fields
POST {{BASE_URL}}/resources
Content-Type: application/json
{
  "entry": "{{entry_id}}",
  "block": "{{block_id}}",
  "name": "Test Resource",
  "description": "A test resource with all fields",
  "mime": "application/json",
  "category": "test-category"
}

HTTP 201
[Captures]
full_resource_id: jsonpath "$._id"
[Asserts]
jsonpath "$.entry" == "{{entry_id}}"
jsonpath "$.block" == "{{block_id}}"
jsonpath "$.name" == "Test Resource"
jsonpath "$.description" == "A test resource with all fields"
jsonpath "$.mime" == "application/json"
jsonpath "$.category" == "test-category"
jsonpath "$.isInvalid" == false
jsonpath "$.createdAt" isInteger
jsonpath "$.updatedAt" isInteger

# Test 3: Create resource without required fields should fail
POST {{BASE_URL}}/resources
Content-Type: application/json
{
  "name": "Missing Required Fields"
}

HTTP 400
[Asserts]
jsonpath "$.error" exists

# Cleanup: Delete all created resources
DELETE {{BASE_URL}}/resources/{{resource_id}}

HTTP 204

DELETE {{BASE_URL}}/resources/{{full_resource_id}}

HTTP 204

# Cleanup: Delete entry
DELETE {{BASE_URL}}/entries/{{entry_id}}

HTTP 204

# Verify cleanup: Resources should not be found after deletion
GET {{BASE_URL}}/resources/{{resource_id}}

HTTP 404

GET {{BASE_URL}}/resources/{{full_resource_id}}

HTTP 404

GET {{BASE_URL}}/entries/{{entry_id}}

HTTP 404

# Verify block has linkCount 0 (orphaned but queryable)
GET {{BASE_URL}}/blocks/{{block_id}}

HTTP 200
[Asserts]
jsonpath "$.linkCount" == 0
