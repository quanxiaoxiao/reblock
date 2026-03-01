# Entry API Tests - Delete (Soft Delete)

# Setup: Create an entry to test with
POST {{BASE_URL}}/entries
Content-Type: application/json
{
  "name": "Entry to Delete",
  "alias": "delete-test-{{timestamp}}"
}

HTTP 201
[Captures]
delete_entry_id: jsonpath "$._id"
delete_entry_updated_at: jsonpath "$.updatedAt"

# Test 1: Delete entry (soft delete)
DELETE {{BASE_URL}}/entries/{{delete_entry_id}}

HTTP 204

# Test 2: Deleted entry should not be found
GET {{BASE_URL}}/entries/{{delete_entry_id}}

HTTP 404

# Test 3: Deleted entry should not appear in list
GET {{BASE_URL}}/entries

HTTP 200
[Asserts]
jsonpath "$[*]._id" not contains "{{delete_entry_id}}"

# Test 4: Delete non-existent entry should return 404
DELETE {{BASE_URL}}/entries/507f1f77bcf86cd799439099

HTTP 404
[Asserts]
jsonpath "$.error" exists

# Setup: Create another entry for update after delete test
POST {{BASE_URL}}/entries
Content-Type: application/json
{
  "name": "Entry for Update After Delete Test",
  "alias": "update-delete-test-{{timestamp}}"
}

HTTP 201
[Captures]
delete_update_entry_id: jsonpath "$._id"

# Test 5: Delete entry
DELETE {{BASE_URL}}/entries/{{delete_update_entry_id}}

HTTP 204

# Test 6: Update deleted entry should return 404
PUT {{BASE_URL}}/entries/{{delete_update_entry_id}}
Content-Type: application/json
{
  "name": "Updated Name"
}

HTTP 404
