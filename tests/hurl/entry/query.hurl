# Entry API Tests - Read and List

# Setup: Create an entry to test with
POST {{BASE_URL}}/entries
Content-Type: application/json
{
  "name": "Entry for Get Test",
  "alias": "get-test-alias-{{timestamp}}",
  "order": 5,
  "description": "Entry used for get testing"
}

HTTP 201
[Captures]
get_entry_id: jsonpath "$._id"
get_entry_created_at: jsonpath "$.createdAt"

# Test 1: Get entry by ID
GET {{BASE_URL}}/entries/{{get_entry_id}}

HTTP 200
[Asserts]
jsonpath "$.name" == "Entry for Get Test"
jsonpath "$.alias" == "get-test-alias-{{timestamp}}"
jsonpath "$.order" == 5
jsonpath "$.description" == "Entry used for get testing"
jsonpath "$._id" == "{{get_entry_id}}"
jsonpath "$.createdAt" == {{get_entry_created_at}}

# Test 2: List all entries
GET {{BASE_URL}}/entries

HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$" isCollection

# Test 3: Get non-existent entry should return 404
GET {{BASE_URL}}/entries/507f1f77bcf86cd799439099

HTTP 404
[Asserts]
jsonpath "$.error" exists

# Cleanup: Delete test entry
DELETE {{BASE_URL}}/entries/{{get_entry_id}}

HTTP 204

# Verify cleanup: Entry should not be found after deletion
GET {{BASE_URL}}/entries/{{get_entry_id}}

HTTP 404
