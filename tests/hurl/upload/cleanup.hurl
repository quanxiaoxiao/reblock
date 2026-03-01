# Upload API Tests - Cleanup and Deleted Entry Behavior

# Setup: Create an entry
POST {{BASE_URL}}/entries
Content-Type: application/json
{
  "name": "Cleanup Test Entry",
  "alias": "cleanup-test-{{timestamp}}"
}

HTTP 201
[Captures]
entry_id: jsonpath "$._id"
entry_alias: jsonpath "$.alias"

# Upload a resource
POST {{BASE_URL}}/upload/{{entry_alias}}
Content-Type: application/octet-stream
file,test-data.bin;

HTTP 201
[Captures]
resource_id: jsonpath "$._id"

################################################################################
# Test: Delete entry (cascade soft delete resources)
################################################################################

DELETE {{BASE_URL}}/entries/{{entry_id}}

HTTP 204

# Verify entry is soft-deleted (should return 404)
GET {{BASE_URL}}/entries/{{entry_id}}

HTTP 404

################################################################################
# Test: Resource is also soft-deleted due to cascade delete
# (entry delete now cascades to soft delete associated resources)
################################################################################

# Try to get the resource - should return 404 because it was cascade soft-deleted
GET {{BASE_URL}}/resources/{{resource_id}}

HTTP 404

################################################################################
# Test: Uploading to deleted entry should return 404
# (per timestamp-soft-delete.rule.md - soft deleted entries must be excluded)
################################################################################

POST {{BASE_URL}}/upload/{{entry_alias}}
Content-Type: application/octet-stream
file,test-data.bin;

HTTP 404
[Asserts]
jsonpath "$.error" == "Entry not found"
