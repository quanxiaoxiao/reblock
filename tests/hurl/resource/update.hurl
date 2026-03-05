# Resource API Tests - Update

# Setup: Create an entry first
POST {{BASE_URL}}/entries
Content-Type: application/json
{
  "name": "Resource Update Test Entry",
  "alias": "resource-update-entry-{{timestamp}}"
}

HTTP 201
[Captures]
entry_id: jsonpath "$._id"
entry_alias: jsonpath "$.alias"

# Setup: Upload first file to create block1
POST {{BASE_URL}}/upload/{{entry_alias}}
Content-Type: application/octet-stream
```
resource-update-block1-content-{{timestamp}}
```

HTTP 201
[Captures]
uploaded_resource1_id: jsonpath "$._id"
block_id: jsonpath "$.block"

# Delete first uploaded resource, keep block1
DELETE {{BASE_URL}}/resources/{{uploaded_resource1_id}}

HTTP 204

# Setup: Upload second file to create block2
POST {{BASE_URL}}/upload/{{entry_alias}}
Content-Type: application/octet-stream
```
resource-update-block2-content-{{timestamp}}
```

HTTP 201
[Captures]
uploaded_resource2_id: jsonpath "$._id"
block2_id: jsonpath "$.block"

# Delete second uploaded resource, keep block2
DELETE {{BASE_URL}}/resources/{{uploaded_resource2_id}}

HTTP 204

# Setup: Create a resource to update using block1
POST {{BASE_URL}}/resources
Content-Type: application/json
{
  "entry": "{{entry_id}}",
  "block": "{{block_id}}",
  "name": "Original Resource",
  "description": "Original description",
  "mime": "text/plain"
}

HTTP 201
[Captures]
resource_id: jsonpath "$._id"
resource_created_at: jsonpath "$.createdAt"

# Test 1: Update resource name and description
PUT {{BASE_URL}}/resources/{{resource_id}}
Content-Type: application/json
{
  "name": "Updated Resource",
  "description": "Updated description"
}

HTTP 200
[Asserts]
jsonpath "$.name" == "Updated Resource"
jsonpath "$.description" == "Updated description"
jsonpath "$.mime" == "text/plain"
jsonpath "$.entry" == "{{entry_id}}"
jsonpath "$.block" == "{{block_id}}"
jsonpath "$._id" == "{{resource_id}}"
jsonpath "$.createdAt" == {{resource_created_at}}
jsonpath "$.updatedAt" isInteger
jsonpath "$.updatedAt" > {{resource_created_at}}

# Test 2: Update resource block reference (PATCH only)
PATCH {{BASE_URL}}/resources/{{resource_id}}/block
Content-Type: application/json
{
  "newBlockId": "{{block2_id}}"
}

HTTP 200
[Asserts]
jsonpath "$.block" == "{{block2_id}}"
jsonpath "$.name" == "Updated Resource"

# Test 3: PUT update must reject block field
PUT {{BASE_URL}}/resources/{{resource_id}}
Content-Type: application/json
{
  "block": "{{block_id}}"
}

HTTP 400
[Asserts]
jsonpath "$.error" exists

# Test 4: Update resource with empty body (no-op)
PUT {{BASE_URL}}/resources/{{resource_id}}
Content-Type: application/json
{}

HTTP 200
[Asserts]
jsonpath "$._id" == "{{resource_id}}"
jsonpath "$.entry" == "{{entry_id}}"

# Test 5: Update non-existent resource should return 404
PUT {{BASE_URL}}/resources/507f1f77bcf86cd799439099
Content-Type: application/json
{
  "name": "Non-existent Resource"
}

HTTP 404
[Asserts]
jsonpath "$.error" exists

# Test 6: Update resource mime
PUT {{BASE_URL}}/resources/{{resource_id}}
Content-Type: application/json
{
  "mime": "application/json"
}

HTTP 200
[Asserts]
jsonpath "$.mime" == "application/json"
jsonpath "$.name" == "Updated Resource"

# Cleanup: Delete created resource
DELETE {{BASE_URL}}/resources/{{resource_id}}

HTTP 204

# Cleanup: Delete entry
DELETE {{BASE_URL}}/entries/{{entry_id}}

HTTP 204

# Verify cleanup
GET {{BASE_URL}}/resources/{{resource_id}}

HTTP 404

GET {{BASE_URL}}/entries/{{entry_id}}

HTTP 404

# Verify blocks have linkCount 0 (orphaned but queryable)
GET {{BASE_URL}}/blocks/{{block_id}}

HTTP 200
[Asserts]
jsonpath "$.linkCount" == 0

GET {{BASE_URL}}/blocks/{{block2_id}}

HTTP 200
[Asserts]
jsonpath "$.linkCount" == 0
