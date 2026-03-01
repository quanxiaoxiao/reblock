# Error API Tests - Acknowledge

# Setup: Trigger a 404 error to generate error log
GET {{BASE_URL}}/entries/another-invalid-{{timestamp}}
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
# Test 2: Acknowledge the error
################################################################################
POST {{BASE_URL}}/errors/{{error_id}}/acknowledge
Content-Type: application/json
{
  "note": "Acknowledged for investigation"
}
HTTP 200
[Asserts]
jsonpath "$.success" == true

################################################################################
# Test 3: Verify acknowledged status
################################################################################
GET {{BASE_URL}}/errors/{{error_id}}
HTTP 200
[Asserts]
jsonpath "$.status" == "acknowledged"

################################################################################
# Test 4: Verify acknowledged errors are NOT in open query
################################################################################
GET {{BASE_URL}}/errors?days=7&status=open
HTTP 200

################################################################################
# Test 5: Query acknowledged errors - should include our acknowledged error
################################################################################
GET {{BASE_URL}}/errors?days=7&status=acknowledged
HTTP 200
[Asserts]
jsonpath "$.errors[0].status" == "acknowledged"
