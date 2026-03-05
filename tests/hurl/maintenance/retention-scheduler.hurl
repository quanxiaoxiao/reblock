# Maintenance API Tests - Entry retention scheduled cleanup

# Scenario A: Resource should be deleted by internal scheduler when entry has retentionMs=1
POST {{BASE_URL}}/entries
Content-Type: application/json
{
  "name": "Retention Expire Entry",
  "alias": "retention-expire-{{timestamp}}",
  "uploadConfig": {
    "retentionMs": 1
  }
}

HTTP 201
[Captures]
expire_entry_id: jsonpath "$._id"
expire_entry_alias: jsonpath "$.alias"

POST {{BASE_URL}}/upload/{{expire_entry_alias}}
Content-Type: application/octet-stream
```
retention-expire-content-{{timestamp}}
```

HTTP 201
[Captures]
expired_resource_id: jsonpath "$._id"

GET {{BASE_URL}}/resources/{{expired_resource_id}}
[Options]
retry: 40
retry-interval: 100

HTTP 404
[Asserts]
jsonpath "$.error" exists

# Scenario B: Resource should remain when entry has no retentionMs
POST {{BASE_URL}}/entries
Content-Type: application/json
{
  "name": "Retention Keep Entry",
  "alias": "retention-keep-{{timestamp}}"
}

HTTP 201
[Captures]
keep_entry_id: jsonpath "$._id"
keep_entry_alias: jsonpath "$.alias"

POST {{BASE_URL}}/upload/{{keep_entry_alias}}
Content-Type: application/octet-stream
```
retention-keep-content-{{timestamp}}
```

HTTP 201
[Captures]
keep_resource_id: jsonpath "$._id"

GET {{BASE_URL}}/resources/{{keep_resource_id}}

HTTP 200
[Asserts]
jsonpath "$._id" == "{{keep_resource_id}}"

DELETE {{BASE_URL}}/resources/{{keep_resource_id}}

HTTP 204

GET {{BASE_URL}}/resources/{{keep_resource_id}}

HTTP 404
[Asserts]
jsonpath "$.error" exists

DELETE {{BASE_URL}}/entries/{{keep_entry_id}}

HTTP 204

GET {{BASE_URL}}/entries/{{keep_entry_id}}

HTTP 404
[Asserts]
jsonpath "$.error" exists

DELETE {{BASE_URL}}/entries/{{expire_entry_id}}

HTTP 204

GET {{BASE_URL}}/entries/{{expire_entry_id}}

HTTP 404
[Asserts]
jsonpath "$.error" exists
