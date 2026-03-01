# Error API Tests - Resolve

################################################################################
# Test 1: Create a test error first
################################################################################
POST {{BASE_URL}}/errors/test/create
Content-Type: application/json
{
  "message": "Test error for resolve test"
}
HTTP 201
[Captures]
error_uuid: jsonpath "$.errorId"

################################################################################
# Test 2: Query open errors
################################################################################
GET {{BASE_URL}}/errors?days=7&status=open
HTTP 200
[Captures]
error_id: jsonpath "$.errors[0]._id"
[Asserts]
jsonpath "$.total" >= 1

################################################################################
# Test 3: Get error detail
################################################################################
GET {{BASE_URL}}/errors/{{error_id}}
HTTP 200
[Asserts]
jsonpath "$.status" == "open"

################################################################################
# Test 4: Export AI format
################################################################################
GET {{BASE_URL}}/errors/{{error_id}}/export
HTTP 200
[Asserts]
jsonpath "$.errorId" exists
jsonpath "$.summary" exists
jsonpath "$.reproduction.method" exists
jsonpath "$.reproduction.path" exists

################################################################################
# Test 5: Resolve the error
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
# Test 6: Verify resolved status
################################################################################
GET {{BASE_URL}}/errors/{{error_id}}
HTTP 200
[Asserts]
jsonpath "$.status" == "resolved"
jsonpath "$.resolution" == "Fixed in hurl test"

################################################################################
# Test 7: Query resolved errors - should include our resolved error
################################################################################
GET {{BASE_URL}}/errors?days=7&status=resolved
HTTP 200
[Asserts]
jsonpath "$.total" >= 1
