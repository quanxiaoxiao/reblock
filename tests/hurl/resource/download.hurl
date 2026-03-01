# Resource API Tests - Download

# Setup: Create an entry
POST {{BASE_URL}}/entries
Content-Type: application/json
{
  "name": "Download Test Entry",
  "alias": "download-test-entry-{{timestamp}}"
}

HTTP 201
[Captures]
entry_id: jsonpath "$._id"
entry_alias: jsonpath "$.alias"

# Setup: Upload a file
POST {{BASE_URL}}/upload/{{entry_alias}}
Content-Type: application/octet-stream
file,download-test-content.bin;

HTTP 201
[Captures]
resource_id: jsonpath "$._id"
resource_name: jsonpath "$.name"

# Test 1: Download resource (attachment)
GET {{BASE_URL}}/resources/{{resource_id}}/download

HTTP 200
[Asserts]
header "Content-Type" == "application/octet-stream"
header "Content-Disposition" contains "attachment"
header "Content-Disposition" contains "download"
header "Content-Length" exists
body == "download-test-content-fixed"

# Test 2: Download resource (inline)
GET {{BASE_URL}}/resources/{{resource_id}}/download?inline=true

HTTP 200
[Asserts]
header "Content-Type" == "application/octet-stream"
header "Content-Disposition" contains "inline"
header "Content-Disposition" contains "download"
header "Content-Length" exists
body == "download-test-content-fixed"

# Test 3: Download non-existent resource
GET {{BASE_URL}}/resources/507f1f77bcf86cd799439099/download

HTTP 404
[Asserts]
jsonpath "$.error" exists
jsonpath "$.code" not exists

# Test 4: Download with MIME type
# First update resource with mime
PUT {{BASE_URL}}/resources/{{resource_id}}
Content-Type: application/json
{
  "mime": "text/plain",
  "name": "test.txt"
}

HTTP 200

# Now download and check MIME
GET {{BASE_URL}}/resources/{{resource_id}}/download

HTTP 200
[Asserts]
header "Content-Type" == "text/plain"
header "Content-Disposition" contains "test.txt"

# Cleanup: Delete resource
DELETE {{BASE_URL}}/resources/{{resource_id}}

HTTP 204

# Cleanup: Delete entry
DELETE {{BASE_URL}}/entries/{{entry_id}}

HTTP 204
