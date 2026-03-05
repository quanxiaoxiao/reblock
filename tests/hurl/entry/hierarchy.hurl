# Entry API Tests - Hierarchy (parentEntryId)

# Setup: create parent entry
POST {{BASE_URL}}/entries
Content-Type: application/json
{
  "name": "Hierarchy Parent",
  "alias": "hier-parent-{{timestamp}}"
}

HTTP 201
[Captures]
parent_entry_id: jsonpath "$._id"

# Setup: create child entry
POST {{BASE_URL}}/entries
Content-Type: application/json
{
  "name": "Hierarchy Child",
  "alias": "hier-child-{{timestamp}}",
  "parentEntryId": "{{parent_entry_id}}"
}

HTTP 201
[Captures]
child_entry_id: jsonpath "$._id"
[Asserts]
jsonpath "$.parentEntryId" == "{{parent_entry_id}}"

# Query children by parentEntryId
GET {{BASE_URL}}/entries?parentEntryId={{parent_entry_id}}

HTTP 200
[Asserts]
jsonpath "$.total" == 1
jsonpath "$.items[0]._id" == "{{child_entry_id}}"

# Delete parent should fail when child exists
DELETE {{BASE_URL}}/entries/{{parent_entry_id}}

HTTP 409
[Asserts]
jsonpath "$.error" == "entry has children"

# Delete child first
DELETE {{BASE_URL}}/entries/{{child_entry_id}}

HTTP 204

# Then delete parent should succeed
DELETE {{BASE_URL}}/entries/{{parent_entry_id}}

HTTP 204

# Verify cleanup
GET {{BASE_URL}}/entries/{{child_entry_id}}

HTTP 404
[Asserts]
jsonpath "$.error" exists

GET {{BASE_URL}}/entries/{{parent_entry_id}}

HTTP 404
[Asserts]
jsonpath "$.error" exists
