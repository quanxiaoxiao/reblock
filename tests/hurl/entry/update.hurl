# Entry API Tests - Update

# Setup: Create an entry to test with
POST {{BASE_URL}}/entries
Content-Type: application/json
{
  "name": "Original Entry",
  "alias": "original-alias-{{timestamp}}",
  "order": 1,
  "description": "Original description"
}

HTTP 201
[Captures]
update_entry_id: jsonpath "$._id"
original_created_at: jsonpath "$.createdAt"
original_updated_at: jsonpath "$.updatedAt"

# Test 1: Update entry name
PUT {{BASE_URL}}/entries/{{update_entry_id}}
Content-Type: application/json
{
  "name": "Updated Entry"
}

HTTP 200
[Asserts]
jsonpath "$.name" == "Updated Entry"
jsonpath "$.alias" == "original-alias-{{timestamp}}"
jsonpath "$.order" == 1
jsonpath "$.description" == "Original description"
jsonpath "$._id" == "{{update_entry_id}}"
jsonpath "$.createdAt" == {{original_created_at}}
jsonpath "$.updatedAt" > {{original_updated_at}}

# Test 2: Update multiple fields
PUT {{BASE_URL}}/entries/{{update_entry_id}}
Content-Type: application/json
{
  "name": "Fully Updated Entry",
  "alias": "updated-alias-{{timestamp}}",
  "order": 100,
  "description": "Updated description"
}

HTTP 200
[Asserts]
jsonpath "$.name" == "Fully Updated Entry"
jsonpath "$.alias" == "updated-alias-{{timestamp}}"
jsonpath "$.order" == 100
jsonpath "$.description" == "Updated description"

# Test 3: Update entry with empty name should fail
PUT {{BASE_URL}}/entries/{{update_entry_id}}
Content-Type: application/json
{
  "name": ""
}

HTTP 400
[Asserts]
jsonpath "$.error" exists

# Test 4: Update non-existent entry should return 404
PUT {{BASE_URL}}/entries/507f1f77bcf86cd799439099
Content-Type: application/json
{
  "name": "Non Existent"
}

HTTP 404
[Asserts]
jsonpath "$.error" exists

# Test 5: Update should not allow setting createdAt
PUT {{BASE_URL}}/entries/{{update_entry_id}}
Content-Type: application/json
{
  "name": "Entry with timestamp attempt",
  "createdAt": 9999999999999
}

HTTP 200
[Asserts]
jsonpath "$.name" == "Entry with timestamp attempt"
jsonpath "$.createdAt" == {{original_created_at}}

# Test 6: Update entry to duplicate alias should fail with 409
POST {{BASE_URL}}/entries
Content-Type: application/json
{
  "name": "Another Entry for Duplicate Test",
  "alias": "another-alias-test-{{timestamp}}"
}

HTTP 201
[Captures]
another_entry_id: jsonpath "$._id"

PUT {{BASE_URL}}/entries/{{update_entry_id}}
Content-Type: application/json
{
  "alias": "another-alias-test-{{timestamp}}"
}

HTTP 409
[Asserts]
jsonpath "$.error" == "alias already exists"

# Cleanup: Delete test entries
DELETE {{BASE_URL}}/entries/{{update_entry_id}}

HTTP 204

DELETE {{BASE_URL}}/entries/{{another_entry_id}}

HTTP 204

# Verify cleanup: Entries should not be found after deletion
GET {{BASE_URL}}/entries/{{update_entry_id}}

HTTP 404

GET {{BASE_URL}}/entries/{{another_entry_id}}

HTTP 404
