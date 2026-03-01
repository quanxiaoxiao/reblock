# Upload API Tests - Default Entry

# Setup: Create a default entry to test with
POST {{BASE_URL}}/entries
Content-Type: application/json
{
  "name": "Default Entry Test",
  "alias": "default-entry-{{timestamp}}",
  "isDefault": true
}

HTTP 201
[Captures]
default_entry_id: jsonpath "$._id"
default_entry_alias: jsonpath "$.alias"
[Asserts]
jsonpath "$.isDefault" == true

################################################################################
# Test: Upload to default entry (no alias provided)
################################################################################

POST {{BASE_URL}}/upload
Content-Type: application/octet-stream
file,test-data.bin;

HTTP 201
[Captures]
resource_id: jsonpath "$._id"
[Asserts]
jsonpath "$.entry" == "{{default_entry_id}}"
jsonpath "$.block" exists
jsonpath "$.isInvalid" == false
jsonpath "$.createdAt" isInteger
jsonpath "$.updatedAt" isInteger
jsonpath "$.lastAccessedAt" isInteger
jsonpath "$.clientIp" exists
jsonpath "$.userAgent" exists
jsonpath "$.uploadDuration" isInteger
jsonpath "$.uploadDuration" > 0

################################################################################
# Test: Upload to default entry with explicit alias should also work
################################################################################

POST {{BASE_URL}}/upload/{{default_entry_alias}}
Content-Type: application/octet-stream
file,test-data.bin;

HTTP 201
[Asserts]
jsonpath "$.entry" == "{{default_entry_id}}"
jsonpath "$.block" exists

################################################################################
# Test: 404 when no default entry exists (mark current as invalid)
################################################################################

# First, mark the default entry as invalid
PUT {{BASE_URL}}/entries/{{default_entry_id}}
Content-Type: application/json
{
  "isInvalid": true
}

HTTP 200

# Now try to upload without alias - should get 404
POST {{BASE_URL}}/upload
Content-Type: application/octet-stream
file,test-data.bin;

HTTP 404
[Asserts]
jsonpath "$.error" == "Default entry not found"

# Cleanup: Entry was already marked as invalid (soft-deleted) above
