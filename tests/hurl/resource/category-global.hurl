# Resource Category API - Global category management and resource filtering

# Setup: Create entry
POST {{BASE_URL}}/entries
Content-Type: application/json
{
  "name": "Resource Category Entry",
  "alias": "resource-category-entry-{{timestamp}}"
}

HTTP 201
[Captures]
entry_id: jsonpath "$._id"
entry_alias: jsonpath "$.alias"

# Setup: Upload file to create block
POST {{BASE_URL}}/upload/{{entry_alias}}
Content-Type: application/octet-stream
```
resource-category-content-{{timestamp}}
```

HTTP 201
[Captures]
uploaded_resource_id: jsonpath "$._id"
block_id: jsonpath "$.block"

# Cleanup uploaded resource to keep reusable block only
DELETE {{BASE_URL}}/resources/{{uploaded_resource_id}}

HTTP 204

# Test 1: Create global resource category
POST {{BASE_URL}}/resource-categories
Content-Type: application/json
{
  "name": "Documents {{timestamp}}",
  "iconDataUri": "data:image/svg+xml;base64,PHN2Zy8+",
  "color": "#112233"
}

HTTP 201
[Captures]
category_key: jsonpath "$.key"
[Asserts]
jsonpath "$.name" == "Documents {{timestamp}}"
jsonpath "$.key" exists
jsonpath "$.color" == "#112233"

# Test 2: Create resource with categoryKey
POST {{BASE_URL}}/resources
Content-Type: application/json
{
  "entry": "{{entry_id}}",
  "block": "{{block_id}}",
  "name": "Categorized Resource",
  "categoryKey": "{{category_key}}"
}

HTTP 201
[Captures]
resource_id: jsonpath "$._id"
[Asserts]
jsonpath "$.categoryKey" == "{{category_key}}"

# Test 3: Filter by categoryKey
GET {{BASE_URL}}/resources?entryAlias={{entry_alias}}&categoryKey={{category_key}}

HTTP 200
[Asserts]
jsonpath "$.items" isCollection
jsonpath "$.total" == 1
jsonpath "$.items[0]._id" == "{{resource_id}}"
jsonpath "$.items[0].categoryKey" == "{{category_key}}"

# Test 4: Uncategorized filter should exclude categorized resource
GET {{BASE_URL}}/resources?entryAlias={{entry_alias}}&categoryKey=__none__

HTTP 200
[Asserts]
jsonpath "$.items" isCollection
jsonpath "$.total" == 0

# Test 5: Rename category, key remains immutable
PUT {{BASE_URL}}/resource-categories/{{category_key}}
Content-Type: application/json
{
  "name": "Docs {{timestamp}}",
  "color": "#445566"
}

HTTP 200
[Asserts]
jsonpath "$.key" == "{{category_key}}"
jsonpath "$.name" == "Docs {{timestamp}}"
jsonpath "$.color" == "#445566"

# Test 6: Deleting in-use category should fail
DELETE {{BASE_URL}}/resource-categories/{{category_key}}

HTTP 409
[Asserts]
jsonpath "$.error" exists

# Test 7: Unset resource category and delete category
PUT {{BASE_URL}}/resources/{{resource_id}}
Content-Type: application/json
{
  "categoryKey": ""
}

HTTP 200
[Asserts]
jsonpath "$.categoryKey" == ""

DELETE {{BASE_URL}}/resource-categories/{{category_key}}

HTTP 204

GET {{BASE_URL}}/resource-categories/{{category_key}}

HTTP 404

# Cleanup
DELETE {{BASE_URL}}/resources/{{resource_id}}

HTTP 204

DELETE {{BASE_URL}}/entries/{{entry_id}}

HTTP 204

# Verify cleanup
GET {{BASE_URL}}/resources/{{resource_id}}

HTTP 404

GET {{BASE_URL}}/entries/{{entry_id}}

HTTP 404
