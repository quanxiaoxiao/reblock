# Upload API Tests - Upload Config

# Setup: Create an entry with upload config
POST {{BASE_URL}}/entries
Content-Type: application/json
{
  "name": "Upload Config Test",
  "alias": "upload-config-{{timestamp}}",
  "uploadConfig": {
    "allowedMimeTypes": ["application/octet-stream"],
    "readOnly": false
  }
}

HTTP 201
[Captures]
entry_id: jsonpath "$._id"

# Verify upload config is stored
[Asserts]
jsonpath "$.uploadConfig.allowedMimeTypes[0]" == "application/octet-stream"
jsonpath "$.uploadConfig.readOnly" == false

################################################################################
# Test: Upload file with allowed MIME type
################################################################################

POST {{BASE_URL}}/upload/upload-config-{{timestamp}}
Content-Type: text/plain
file,test-data.bin;

HTTP 201

################################################################################
# Test: Update entry to read-only mode
################################################################################

PUT {{BASE_URL}}/entries/{{entry_id}}
Content-Type: application/json
{
  "uploadConfig": {
    "readOnly": true
  }
}

HTTP 200

# Verify read-only is set
[Asserts]
jsonpath "$.uploadConfig.readOnly" == true

################################################################################
# Test: Upload to read-only entry should fail with 403
################################################################################

POST {{BASE_URL}}/upload/upload-config-{{timestamp}}
Content-Type: text/plain
file,test-data.bin;

HTTP 403
[Asserts]
jsonpath "$.error" == "Entry is read-only"
