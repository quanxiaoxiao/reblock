# Error API Tests - Acknowledge

################################################################################
# Test 1: Create a test error first
################################################################################
POST {{BASE_URL}}/errors/test/create
Content-Type: application/json
{
  "message": "Test error for acknowledge test"
}
HTTP 201
[Captures]
error_uuid: jsonpath "$.errorId"

################################################################################
# Test 2: Query the specific created error in open status
################################################################################
GET {{BASE_URL}}/errors?days=7&status=open&errorId={{error_uuid}}
HTTP 200
[Captures]
error_id: jsonpath "$.errors[0]._id"
[Asserts]
jsonpath "$.total" >= 1
jsonpath "$.errors[0].errorId" == "{{error_uuid}}"

################################################################################
# Test 3: Acknowledge the error
################################################################################
POST {{BASE_URL}}/errors/{{error_id}}/acknowledge
Content-Type: application/json
{
  "note": "Acknowledged in hurl test"
}
HTTP 200
[Asserts]
jsonpath "$.success" == true

################################################################################
# Test 4: Verify acknowledged status
################################################################################
GET {{BASE_URL}}/errors/{{error_id}}
HTTP 200
[Asserts]
jsonpath "$.status" == "acknowledged"
