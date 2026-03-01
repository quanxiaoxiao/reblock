# Entry API Tests - Create

# Test 1: Create entry with minimal data
POST {{BASE_URL}}/entries
Content-Type: application/json
{
  "name": "Test Entry"
}

HTTP 201
[Captures]
entry_id: jsonpath "$._id"
[Asserts]
jsonpath "$.name" == "Test Entry"
jsonpath "$.alias" == ""
jsonpath "$.order" not exists
jsonpath "$.description" == ""
jsonpath "$.isDefault" == false
jsonpath "$.isInvalid" == false
jsonpath "$.invalidatedAt" not exists
jsonpath "$.createdAt" isInteger
jsonpath "$.updatedAt" isInteger
jsonpath "$._id" exists

# Test 2: Create entry with all fields
POST {{BASE_URL}}/entries
Content-Type: application/json
{
  "name": "Full Entry",
  "alias": "full-alias-{{timestamp}}",
  "order": 10,
  "description": "A test entry with all fields"
}

HTTP 201
[Captures]
full_entry_id: jsonpath "$._id"
[Asserts]
jsonpath "$.name" == "Full Entry"
jsonpath "$.alias" == "full-alias-{{timestamp}}"
jsonpath "$.order" == 10
jsonpath "$.description" == "A test entry with all fields"
jsonpath "$.isDefault" == false
jsonpath "$.isInvalid" == false
jsonpath "$.createdAt" isInteger
jsonpath "$.updatedAt" isInteger

# Test 3: Create entry with empty name should fail
POST {{BASE_URL}}/entries
Content-Type: application/json
{
  "name": ""
}

HTTP 400
[Asserts]
jsonpath "$.error" exists

# Test 4: Create entry without name should fail
POST {{BASE_URL}}/entries
Content-Type: application/json
{}

HTTP 400
[Asserts]
jsonpath "$.error" exists

# Test 5: Create entry with duplicate alias should fail with 409
POST {{BASE_URL}}/entries
Content-Type: application/json
{
  "name": "Duplicate Alias Test",
  "alias": "duplicate-alias-test-{{timestamp}}"
}

HTTP 201
[Captures]
dup_test_entry_id: jsonpath "$._id"

POST {{BASE_URL}}/entries
Content-Type: application/json
{
  "name": "Another Entry",
  "alias": "duplicate-alias-test-{{timestamp}}"
}

HTTP 409
[Asserts]
jsonpath "$.error" == "alias already exists"

# Test 6: Deleted entry's alias can be reused
DELETE {{BASE_URL}}/entries/{{dup_test_entry_id}}

HTTP 204

POST {{BASE_URL}}/entries
Content-Type: application/json
{
  "name": "Reused Alias Entry",
  "alias": "duplicate-alias-test-{{timestamp}}"
}

HTTP 201
[Captures]
reused_alias_entry_id: jsonpath "$._id"
[Asserts]
jsonpath "$.alias" == "duplicate-alias-test-{{timestamp}}"

# Cleanup: Delete all created entries
DELETE {{BASE_URL}}/entries/{{entry_id}}

HTTP 204

DELETE {{BASE_URL}}/entries/{{full_entry_id}}

HTTP 204

DELETE {{BASE_URL}}/entries/{{reused_alias_entry_id}}

HTTP 204

# Verify cleanup: Entries should not be found after deletion
GET {{BASE_URL}}/entries/{{entry_id}}

HTTP 404

GET {{BASE_URL}}/entries/{{full_entry_id}}

HTTP 404

GET {{BASE_URL}}/entries/{{reused_alias_entry_id}}

HTTP 404
