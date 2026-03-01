# Error API Template - RequestId Correlation
# Purpose: correlate a failing request and /errors record by X-Request-Id

# Step 1: Create a deterministic test error with request id header
POST {{BASE_URL}}/errors/test/create
Content-Type: application/json
x-request-id: hurl-req-{{timestamp}}
x-errors-token: {{ERRORS_TOKEN}}
{
  "message": "request-id correlation template"
}

HTTP 201
[Captures]
created_error_uuid: jsonpath "$.errorId"

# Step 2: Query /errors using requestId + errorId filter (deterministic match)
GET {{BASE_URL}}/errors?days=1&status=open&requestId=hurl-req-{{timestamp}}&errorId={{created_error_uuid}}
x-errors-token: {{ERRORS_TOKEN}}

HTTP 200
[Captures]
error_doc_id: jsonpath "$.errors[0]._id"
[Asserts]
jsonpath "$.total" >= 1
jsonpath "$.errors[0].errorId" == "{{created_error_uuid}}"

# Step 3: Verify details endpoint contains the same requestId context
GET {{BASE_URL}}/errors/{{error_doc_id}}
x-errors-token: {{ERRORS_TOKEN}}

HTTP 200
[Asserts]
jsonpath "$.context.requestId" == "hurl-req-{{timestamp}}"
jsonpath "$.details.requestId" == "hurl-req-{{timestamp}}"
