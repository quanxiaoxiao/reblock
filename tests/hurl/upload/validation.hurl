# Upload API Tests - Validation

# Setup: Create an entry to test with
POST {{BASE_URL}}/entries
Content-Type: application/json
{
  "name": "Validation Test Entry",
  "alias": "validation-test-{{timestamp}}"
}

HTTP 201
[Captures]
entry_id: jsonpath "$._id"
entry_alias: jsonpath "$.alias"

################################################################################
# Test 1: Empty body should return 400
################################################################################

POST {{BASE_URL}}/upload/{{entry_alias}}
Content-Type: application/octet-stream

HTTP 400

################################################################################
# Test 2: Any content type should be accepted (no restriction)
################################################################################

POST {{BASE_URL}}/upload/{{entry_alias}}
Content-Type: text/plain
```
plain text content
```

HTTP 201

################################################################################
# Test 3: JSON content type should also be accepted
################################################################################

POST {{BASE_URL}}/upload/{{entry_alias}}
Content-Type: application/json
{
  "data": "test"
}

HTTP 201

################################################################################
# Test 4: Non-existing entry should return 404
################################################################################

POST {{BASE_URL}}/upload/not-exists-{{timestamp}}
Content-Type: application/octet-stream
file,test-data.bin;

HTTP 404
[Asserts]
jsonpath "$.error" == "Entry not found"

################################################################################
# Cleanup
################################################################################

DELETE {{BASE_URL}}/entries/{{entry_id}}

HTTP 204
