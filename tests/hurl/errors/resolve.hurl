# Error API Tests - Resolve

# Setup: Trigger a 404 error to generate error log
GET {{BASE_URL}}/entries/invalid-alias-{{timestamp}}
HTTP 404

################################################################################
# Test 1: Query open errors
################################################################################
GET {{BASE_URL}}/errors?days=7&status=open
HTTP 200
[Captures]
error_id: jsonpath "$.errors[0]._id"
[Asserts]
jsonpath "$.total" >= 1

################################################################################
# Test 2: Get error detail
################################################################################
GET {{BASE_URL}}/errors/{{error_id}}
HTTP 200
[Asserts]
jsonpath "$.status" == "open"

################################################################################
# Test 3: Export AI format
################################################################################
GET {{BASE_URL}}/errors/{{error_id}}/export
HTTP 200
[Asserts]
jsonpath "$.errorId" exists
jsonpath "$.summary" exists
jsonpath "$.reproduction.method" exists
jsonpath "$.reproduction.path" exists

################################################################################
# Test 4: Resolve the error
################################################################################
POST {{BASE_URL}}/errors/{{error_id}}/resolve
Content-Type: application/json
{
  "resolution": "Fixed in hurl test"
}
HTTP 200
[Asserts]
jsonpath "$.success" == true

################################################################################
# Test 5: Verify resolved status
################################################################################
GET {{BASE_URL}}/errors/{{error_id}}
HTTP 200
[Asserts]
jsonpath "$.status" == "resolved"
jsonpath "$.resolution" == "Fixed in hurl test"

################################################################################
# Test 6: Query resolved errors - should include our resolved error
################################################################################
GET {{BASE_URL}}/errors?days=7&status=resolved
HTTP 200
[Asserts]
jsonpath "$.total" >= 1
