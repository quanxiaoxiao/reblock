# Upload API Tests - Create

# Setup: Create an entry to test with
POST {{BASE_URL}}/entries
Content-Type: application/json
{
  "name": "Upload Test Entry",
  "alias": "upload-test-{{timestamp}}"
}

HTTP 201
[Captures]
entry_id: jsonpath "$._id"
entry_alias: jsonpath "$.alias"

################################################################################
# Test: Upload a binary file to entry by alias
################################################################################

POST {{BASE_URL}}/upload/{{entry_alias}}
Content-Type: application/octet-stream
file,test-data.bin;

HTTP 201
[Captures]
resource_id: jsonpath "$._id"
block_id: jsonpath "$.block"

[Asserts]
jsonpath "$.entry" == "{{entry_id}}"
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
# Test: Upload file with name parameter
################################################################################

POST {{BASE_URL}}/upload/{{entry_alias}}?name=test-named-file.txt
Content-Type: text/plain
file,test-named-content.txt;

HTTP 201
[Captures]
resource_id_named: jsonpath "$._id"

[Asserts]
jsonpath "$.name" == "test-named-file.txt"

################################################################################
# Test: Upload file with name parameter and custom mime type
################################################################################

POST {{BASE_URL}}/upload/{{entry_alias}}?name=test-custom-mime.json
Content-Type: application/json
file,test-data.bin;

HTTP 201
[Captures]
resource_id_mime: jsonpath "$._id"

[Asserts]
jsonpath "$.name" == "test-custom-mime.json"

################################################################################
# Test: Upload file without name parameter (should be empty)
################################################################################

POST {{BASE_URL}}/upload/{{entry_alias}}
Content-Type: application/octet-stream
file,test-data.bin;

HTTP 201

[Asserts]
jsonpath "$.name" == ""
