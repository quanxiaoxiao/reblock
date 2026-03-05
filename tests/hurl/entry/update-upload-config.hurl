# Entry API Tests - Update UploadConfig
# Tests for updating entry upload configuration

# Setup: Create an entry to test with
POST {{BASE_URL}}/entries
Content-Type: application/json
{
  "name": "Upload Config Test Entry",
  "alias": "upload-config-test-{{timestamp}}"
}

HTTP 201
[Captures]
entry_id: jsonpath "$._id"

# Test 1: Update entry with uploadConfig (maxFileSize only)
# Note: When updating uploadConfig, the entire object is replaced
PUT {{BASE_URL}}/entries/{{entry_id}}
Content-Type: application/json
{
  "uploadConfig": {
    "maxFileSize": 10485760
  }
}

HTTP 200
[Asserts]
jsonpath "$.uploadConfig.maxFileSize" == 10485760
# Other fields have default values
jsonpath "$.uploadConfig.allowedMimeTypes" count == 0
jsonpath "$.uploadConfig.readOnly" == false

# Test 2: Update entry with complete uploadConfig (all fields)
PUT {{BASE_URL}}/entries/{{entry_id}}
Content-Type: application/json
{
  "uploadConfig": {
    "maxFileSize": 10485760,
    "allowedMimeTypes": ["image/jpeg", "image/png", "application/pdf"],
    "readOnly": false
  }
}

HTTP 200
[Asserts]
jsonpath "$.uploadConfig.maxFileSize" == 10485760
jsonpath "$.uploadConfig.allowedMimeTypes" count == 3
jsonpath "$.uploadConfig.allowedMimeTypes[0]" == "image/jpeg"
jsonpath "$.uploadConfig.allowedMimeTypes[1]" == "image/png"
jsonpath "$.uploadConfig.allowedMimeTypes[2]" == "application/pdf"
jsonpath "$.uploadConfig.readOnly" == false

# Test 3: Update entry with different allowedMimeTypes
PUT {{BASE_URL}}/entries/{{entry_id}}
Content-Type: application/json
{
  "uploadConfig": {
    "maxFileSize": 10485760,
    "allowedMimeTypes": ["image/*", "application/pdf"],
    "readOnly": false
  }
}

HTTP 200
[Asserts]
jsonpath "$.uploadConfig.maxFileSize" == 10485760
jsonpath "$.uploadConfig.allowedMimeTypes" count == 2
jsonpath "$.uploadConfig.allowedMimeTypes[0]" == "image/*"
jsonpath "$.uploadConfig.readOnly" == false

# Test 4: Update entry with readOnly set to true
PUT {{BASE_URL}}/entries/{{entry_id}}
Content-Type: application/json
{
  "uploadConfig": {
    "maxFileSize": 20971520,
    "allowedMimeTypes": ["image/*", "application/pdf", "text/plain"],
    "readOnly": true
  }
}

HTTP 200
[Asserts]
jsonpath "$.uploadConfig.maxFileSize" == 20971520
jsonpath "$.uploadConfig.allowedMimeTypes" count == 3
jsonpath "$.uploadConfig.allowedMimeTypes[0]" == "image/*"
jsonpath "$.uploadConfig.readOnly" == true

# Test 5: Update entry isDefault to true (should preserve uploadConfig)
PUT {{BASE_URL}}/entries/{{entry_id}}
Content-Type: application/json
{
  "isDefault": true
}

HTTP 200
[Asserts]
jsonpath "$.isDefault" == true
# uploadConfig should be preserved since we're not updating it
jsonpath "$.uploadConfig.maxFileSize" == 20971520

# Test 6: Update entry isDefault to false
PUT {{BASE_URL}}/entries/{{entry_id}}
Content-Type: application/json
{
  "isDefault": false
}

HTTP 200
[Asserts]
jsonpath "$.isDefault" == false

# Test 7: Combined update - name, uploadConfig and isDefault
PUT {{BASE_URL}}/entries/{{entry_id}}
Content-Type: application/json
{
  "name": "Updated Upload Config Entry",
  "uploadConfig": {
    "maxFileSize": 5242880,
    "allowedMimeTypes": ["image/jpeg"],
    "readOnly": false
  },
  "isDefault": true
}

HTTP 200
[Asserts]
jsonpath "$.name" == "Updated Upload Config Entry"
jsonpath "$.uploadConfig.maxFileSize" == 5242880
jsonpath "$.uploadConfig.allowedMimeTypes" count == 1
jsonpath "$.uploadConfig.allowedMimeTypes[0]" == "image/jpeg"
jsonpath "$.uploadConfig.readOnly" == false
jsonpath "$.isDefault" == true

# Test 8: Update with empty uploadConfig (should clear all fields to defaults)
PUT {{BASE_URL}}/entries/{{entry_id}}
Content-Type: application/json
{
  "uploadConfig": {}
}

HTTP 200
[Asserts]
# Empty object results in default values
jsonpath "$.uploadConfig.maxFileSize" not exists
jsonpath "$.uploadConfig.allowedMimeTypes" count == 0
jsonpath "$.uploadConfig.readOnly" == false

# Test 9: Update non-existent entry with uploadConfig should return 404
PUT {{BASE_URL}}/entries/507f1f77bcf86cd799439099
Content-Type: application/json
{
  "uploadConfig": {
    "maxFileSize": 10485760
  }
}

HTTP 404
[Asserts]
jsonpath "$.error" exists

# Test 10: Update with invalid uploadConfig field type should fail
PUT {{BASE_URL}}/entries/{{entry_id}}
Content-Type: application/json
{
  "uploadConfig": {
    "maxFileSize": "invalid-string"
  }
}

HTTP 400
[Asserts]
jsonpath "$.error" exists

# Test 11: Update with large maxFileSize
PUT {{BASE_URL}}/entries/{{entry_id}}
Content-Type: application/json
{
  "uploadConfig": {
    "maxFileSize": 1073741824
  }
}

HTTP 200
[Asserts]
jsonpath "$.uploadConfig.maxFileSize" == 1073741824

# Test 12: Update with single MIME type
PUT {{BASE_URL}}/entries/{{entry_id}}
Content-Type: application/json
{
  "uploadConfig": {
    "maxFileSize": 10485760,
    "allowedMimeTypes": ["application/pdf"],
    "readOnly": true
  }
}

HTTP 200
[Asserts]
jsonpath "$.uploadConfig.allowedMimeTypes" count == 1
jsonpath "$.uploadConfig.allowedMimeTypes[0]" == "application/pdf"
jsonpath "$.uploadConfig.readOnly" == true

# Test 13: Update with retentionMs (contract test for entry retention config)
PUT {{BASE_URL}}/entries/{{entry_id}}
Content-Type: application/json
{
  "uploadConfig": {
    "maxFileSize": 10485760,
    "allowedMimeTypes": ["application/pdf"],
    "readOnly": false,
    "retentionMs": 60000
  }
}

HTTP 200
[Asserts]
jsonpath "$.uploadConfig.retentionMs" == 60000

# Test 14: retentionMs=0 should fail
PUT {{BASE_URL}}/entries/{{entry_id}}
Content-Type: application/json
{
  "uploadConfig": {
    "retentionMs": 0
  }
}

HTTP 400
[Asserts]
jsonpath "$.error" exists

# Test 15: retentionMs negative should fail
PUT {{BASE_URL}}/entries/{{entry_id}}
Content-Type: application/json
{
  "uploadConfig": {
    "retentionMs": -1
  }
}

HTTP 400
[Asserts]
jsonpath "$.error" exists

# Test 16: retentionMs string type should fail
PUT {{BASE_URL}}/entries/{{entry_id}}
Content-Type: application/json
{
  "uploadConfig": {
    "retentionMs": "abc"
  }
}

HTTP 400
[Asserts]
jsonpath "$.error" exists

# Cleanup: Delete test entry
DELETE {{BASE_URL}}/entries/{{entry_id}}

HTTP 204

# Verify cleanup: Entry should not be found after deletion
GET {{BASE_URL}}/entries/{{entry_id}}

HTTP 404
