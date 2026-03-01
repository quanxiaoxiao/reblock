# Error API Tests - Resolve

################################################################################
# Test 1: Create a test error first
################################################################################
POST {{BASE_URL}}/errors/test/create
Content-Type: application/json
x-errors-token: {{ERRORS_TOKEN}}
{
  "message": "Test error for resolve test"
}
HTTP 201
[Captures]
error_uuid: jsonpath "$.errorId"

################################################################################
# Test 2: Query the specific created error in open status
################################################################################
GET {{BASE_URL}}/errors?days=7&status=open&errorId={{error_uuid}}
x-errors-token: {{ERRORS_TOKEN}}
HTTP 200
[Captures]
error_id: jsonpath "$.errors[0]._id"
[Asserts]
jsonpath "$.total" >= 1
jsonpath "$.errors[0].errorId" == "{{error_uuid}}"

################################################################################
# Test 3: Get error detail
################################################################################
GET {{BASE_URL}}/errors/{{error_id}}
x-errors-token: {{ERRORS_TOKEN}}
HTTP 200
[Asserts]
jsonpath "$.status" == "open"

################################################################################
# Test 4: Export AI format
################################################################################
GET {{BASE_URL}}/errors/{{error_id}}/export
x-errors-token: {{ERRORS_TOKEN}}
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
x-errors-token: {{ERRORS_TOKEN}}
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
x-errors-token: {{ERRORS_TOKEN}}
HTTP 200
[Asserts]
jsonpath "$.status" == "resolved"
jsonpath "$.resolution" == "Fixed in hurl test"

################################################################################
# Test 7: Query resolved errors - should include our resolved error
################################################################################
GET {{BASE_URL}}/errors?days=7&status=resolved
x-errors-token: {{ERRORS_TOKEN}}
HTTP 200
[Asserts]
jsonpath "$.total" >= 1
