# Boundary Conditions Test Rule

This document defines all boundary condition test scenarios that must be covered for comprehensive testing of the Reblock system.

---

## Overview

Boundary condition testing validates edge cases, error conditions, and extreme values to ensure system robustness.

---

## Upload Boundary Conditions

### Empty File Upload

**Test ID:** `UPLOAD_EMPTY_FILE`

**Description:** Upload a file with 0 bytes.

**Preconditions:**
- Entry exists with valid uploadConfig
- Empty file available for upload

**Test Steps:**
1. Create empty file (0 bytes)
2. POST /upload/:entry-alias with empty file

**Expected Results:**
- ✅ HTTP 201 Created
- ✅ Resource created successfully
- ✅ Block created with size: 0
- ✅ SHA256 hash of empty content computed correctly
- ✅ File encrypted and stored properly

**Hurl Example:**
```hurl
POST {{BASE_URL}}/upload/test-entry
Content-Type: application/octet-stream
file,empty-file.bin;

HTTP 201
[Asserts]
jsonpath "$.size" == 0
jsonpath "$.block" exists
```

---

### Maximum File Size Upload

**Test ID:** `UPLOAD_MAX_SIZE`

**Description:** Upload a file exactly at maxFileSize limit.

**Preconditions:**
- Entry configured with maxFileSize: 10485760 (10MB)
- Test file of exactly 10MB available

**Test Steps:**
1. Create 10MB test file
2. POST /upload/:entry-alias with 10MB file

**Expected Results:**
- ✅ HTTP 201 Created
- ✅ Resource created successfully
- ✅ No file size error

---

### File Size Exceeding Limit

**Test ID:** `UPLOAD_OVERSIZE`

**Description:** Upload a file larger than maxFileSize.

**Preconditions:**
- Entry configured with maxFileSize: 10485760 (10MB)
- Test file of 11MB available

**Test Steps:**
1. Create 11MB test file
2. POST /upload/:entry-alias with 11MB file

**Expected Results:**
- ✅ HTTP 413 Payload Too Large
- ✅ Error code: "FILE_TOO_LARGE"
- ✅ No resource created
- ✅ No block created
- ✅ Temp file cleaned up

**Hurl Example:**
```hurl
POST {{BASE_URL}}/upload/test-entry
Content-Type: application/octet-stream
file,11mb-file.bin;

HTTP 413
[Asserts]
jsonpath "$.code" == "FILE_TOO_LARGE"
```

---

### Disallowed MIME Type

**Test ID:** `UPLOAD_DISALLOWED_MIME`

**Description:** Upload a file with MIME type not in allowedMimeTypes.

**Preconditions:**
- Entry configured with allowedMimeTypes: ["image/*", "application/pdf"]
- Test file with MIME type "application/exe" available

**Test Steps:**
1. Prepare executable file (application/exe)
2. POST /upload/:entry-alias with this file

**Expected Results:**
- ✅ HTTP 415 Unsupported Media Type
- ✅ Error code: "INVALID_MIME_TYPE"
- ✅ No resource created
- ✅ No block created

**Hurl Example:**
```hurl
POST {{BASE_URL}}/upload/test-entry
Content-Type: application/exe
file,program.exe;

HTTP 415
[Asserts]
jsonpath "$.code" == "INVALID_MIME_TYPE"
```

---

### Read-only Entry Upload

**Test ID:** `UPLOAD_READ_ONLY_ENTRY`

**Description:** Attempt upload to a read-only entry.

**Preconditions:**
- Entry with uploadConfig.readOnly: true

**Test Steps:**
1. POST /upload/:read-only-entry-alias with any file

**Expected Results:**
- ✅ HTTP 403 Forbidden
- ✅ Error code: "ENTRY_READ_ONLY"
- ✅ No upload processed

---

### Upload with Long Filename

**Test ID:** `UPLOAD_LONG_FILENAME`

**Description:** Upload with filename at maximum length.

**Preconditions:**
- Entry exists and is writable

**Test Steps:**
1. Generate filename of exactly 500 characters
2. POST /upload/:entry-alias?name=[500-char-name]

**Expected Results:**
- ✅ HTTP 201 Created
- ✅ Resource created with truncated or full filename
- ✅ Name field in response matches input (or truncated at 500 chars)

---

## Entry Boundary Conditions

### Entry with Empty Alias

**Test ID:** `ENTRY_EMPTY_ALIAS`

**Description:** Create entry with empty alias.

**Test Steps:**
1. POST /entries with alias: ""

**Expected Results:**
- ✅ HTTP 201 Created
- ✅ Entry created with alias: ""
- ✅ Can be queried but not used for upload (needs non-empty alias)

---

### Entry with Maximum Length Alias

**Test ID:** `ENTRY_MAX_ALIAS`

**Description:** Create entry with alias at 100 characters.

**Test Steps:**
1. Generate alias string of exactly 100 valid characters
2. POST /entries with this alias

**Expected Results:**
- ✅ HTTP 201 Created
- ✅ Entry created successfully
- ✅ Alias preserved exactly

---

### Entry with Invalid Alias Characters

**Test ID:** `ENTRY_INVALID_ALIAS`

**Description:** Create entry with alias containing invalid characters.

**Test Steps:**
1. POST /entries with alias: "My Alias!@#"

**Expected Results:**
- ✅ HTTP 400 Bad Request
- ✅ Error code: "VALIDATION_ERROR"
- ✅ Details indicate invalid alias characters

---

### Entry Alias Uniqueness Conflict

**Test ID:** `ENTRY_ALIAS_CONFLICT`

**Description:** Attempt to create entry with existing alias.

**Preconditions:**
- Entry with alias: "test-alias" already exists

**Test Steps:**
1. POST /entries with alias: "test-alias"

**Expected Results:**
- ✅ HTTP 409 Conflict
- ✅ Error code: "ALIAS_EXISTS"

---

### Multiple Default Entries

**Test ID:** `ENTRY_MULTIPLE_DEFAULTS`

**Description:** Attempt to set second entry as default.

**Preconditions:**
- Entry A exists with isDefault: true

**Test Steps:**
1. PUT /entries/entry-b-id with isDefault: true

**Expected Results:**
- ✅ HTTP 200 OK
- ✅ Entry B now has isDefault: true
- ✅ Entry A now has isDefault: false
- ✅ Only one default entry exists

---

## Resource Boundary Conditions

### Resource with Empty Name

**Test ID:** `RESOURCE_EMPTY_NAME`

**Description:** Create resource with empty name.

**Test Steps:**
1. POST /resources with name: ""

**Expected Results:**
- ✅ HTTP 201 Created
- ✅ Resource created with name: ""

---

### Resource with Long Description

**Test ID:** `RESOURCE_LONG_DESC`

**Description:** Create resource with description at 2000 characters.

**Test Steps:**
1. Generate description string of exactly 2000 characters
2. POST /resources with this description

**Expected Results:**
- ✅ HTTP 201 Created
- ✅ Resource created with full description

---

### Resource Block Switch with Same Block

**Test ID:** `RESOURCE_SAME_BLOCK`

**Description:** Attempt to switch resource block to the same block.

**Preconditions:**
- Resource exists referencing block A

**Test Steps:**
1. PATCH /resources/:id/block with newBlockId: block-A-id

**Expected Results:**
- ✅ HTTP 200 OK (or 204 No Content)
- ✅ No change to resource
- ✅ No change to block linkCount
- ✅ No history record created

---

### Resource Block Switch Version Conflict

**Test ID:** `RESOURCE_VERSION_CONFLICT`

**Description:** Block switch with outdated expectedUpdatedAt.

**Preconditions:**
- Resource exists with updatedAt: 1772241136645
- Resource was updated by another process to updatedAt: 1772242000000

**Test Steps:**
1. PATCH /resources/:id/block with expectedUpdatedAt: 1772241136645

**Expected Results:**
- ✅ HTTP 409 Conflict
- ✅ Error code: "VERSION_CONFLICT"

---

### Resource History Pagination at Bounds

**Test ID:** `RESOURCE_HISTORY_PAGINATION`

**Description:** Query resource history at pagination boundaries.

**Preconditions:**
- Resource has exactly 50 history records

**Test Steps:**
1. GET /resources/:id/history?limit=50&offset=0
2. GET /resources/:id/history?limit=50&offset=50
3. GET /resources/:id/history?limit=200&offset=0

**Expected Results:**
- ✅ First query returns all 50 records
- ✅ Second query returns empty array
- ✅ Third query returns all 50 records (limit capped at 200)

---

## Download Boundary Conditions

### Download at Exact File Boundaries

**Test ID:** `DOWNLOAD_RANGE_BOUNDARIES`

**Description:** Download with ranges at file boundaries.

**Preconditions:**
- Resource exists with file of exactly 10000 bytes

**Test Steps:**
1. GET /resources/:id/download with Range: bytes=0-0
2. GET /resources/:id/download with Range: bytes=9999-9999
3. GET /resources/:id/download with Range: bytes=0-9999

**Expected Results:**
- ✅ First request: HTTP 206, 1 byte returned
- ✅ Second request: HTTP 206, 1 byte returned
- ✅ Third request: HTTP 200 (full file), 10000 bytes

---

### Download Range Exceeding File Size

**Test ID:** `DOWNLOAD_RANGE_OVERFLOW`

**Description:** Download with range beyond file size.

**Preconditions:**
- Resource exists with file of 10000 bytes

**Test Steps:**
1. GET /resources/:id/download with Range: bytes=5000-15000
2. GET /resources/:id/download with Range: bytes=10000-20000

**Expected Results:**
- ✅ HTTP 416 Range Not Satisfiable
- ✅ Content-Range header: bytes */10000

---

### Download Invalid Range Format

**Test ID:** `DOWNLOAD_INVALID_RANGE`

**Description:** Download with malformed Range header.

**Test Steps:**
1. GET /resources/:id/download with Range: bytes=abc-def
2. GET /resources/:id/download with Range: bytes=100-50
3. GET /resources/:id/download with Range: invalid

**Expected Results:**
- ✅ All requests: HTTP 416 or HTTP 200 (full file)
- ✅ System handles invalid ranges gracefully

---

### Download Missing Block File

**Test ID:** `DOWNLOAD_MISSING_FILE`

**Description:** Download when physical block file is missing.

**Preconditions:**
- Resource exists
- Block file deleted from storage manually

**Test Steps:**
1. GET /resources/:id/download

**Expected Results:**
- ✅ HTTP 500 Internal Server Error
- ✅ Error code: "FILE_MISSING"
- ✅ Issue logged with category: "MISSING_FILE"

---

### Download Block Size Mismatch

**Test ID:** `DOWNLOAD_SIZE_MISMATCH`

**Description:** Download when physical file size differs from database.

**Preconditions:**
- Resource exists
- Block file modified (size changed from database value)

**Test Steps:**
1. GET /resources/:id/download

**Expected Results:**
- ✅ HTTP 500 Internal Server Error
- ✅ Error code: "SIZE_MISMATCH"
- ✅ Issue logged with category: "FILE_SIZE_MISMATCH"

---

## Pagination Boundary Conditions

### Pagination with Zero Offset

**Test ID:** `PAGINATION_ZERO_OFFSET`

**Description:** List with offset=0.

**Test Steps:**
1. GET /resources?limit=10&offset=0

**Expected Results:**
- ✅ HTTP 200 OK
- ✅ Returns first 10 items
- ✅ offset in response: 0

---

### Pagination with Large Offset

**Test ID:** `PAGINATION_LARGE_OFFSET`

**Description:** List with offset beyond total items.

**Preconditions:**
- Exactly 42 resources exist

**Test Steps:**
1. GET /resources?limit=10&offset=100

**Expected Results:**
- ✅ HTTP 200 OK
- ✅ items: empty array
- ✅ total: 42

---

### Pagination with Maximum Limit

**Test ID:** `PAGINATION_MAX_LIMIT`

**Description:** List with limit=200 (max allowed).

**Test Steps:**
1. GET /resources?limit=200

**Expected Results:**
- ✅ HTTP 200 OK
- ✅ Up to 200 items returned
- ✅ limit in response: 200

---

### Pagination with Invalid Limit

**Test ID:** `PAGINATION_INVALID_LIMIT`

**Description:** List with invalid limit values.

**Test Steps:**
1. GET /resources?limit=0
2. GET /resources?limit=-5
3. GET /resources?limit=1000
4. GET /resources?limit=abc

**Expected Results:**
- ✅ All requests: HTTP 200 OK
- ✅ Limit clamped to valid range (1-200) or default (50)
- ✅ No error returned (graceful handling)

---

## LogEntry Boundary Conditions

### LogEntry State Transitions

**Test ID:** `LOGENTRY_STATE_TRANSITIONS`

**Description:** Test all valid and invalid LogEntry state transitions.

**Test Steps:**
1. Create LogEntry in 'open' state
2. Acknowledge it → should transition to 'acknowledged'
3. Try to re-open from 'acknowledged' → should fail
4. Resolve from 'acknowledged' → should transition to 'resolved'
5. Try to acknowledge from 'resolved' → should fail
6. Try to ignore from 'resolved' → should fail
7. Create new 'open' entry, ignore it → 'ignored' state
8. Try to transition from 'ignored' → should fail

**Expected Results:**
- ✅ Valid transitions succeed
- ✅ Invalid transitions return 409 Conflict
- ✅ All state changes recorded in statusHistory

---

### LogEntry with Large Details Object

**Test ID:** `LOGENTRY_LARGE_DETAILS`

**Description:** Create LogEntry with large details payload.

**Test Steps:**
1. POST /errors with details object containing 100+ keys
2. Each value at max length (10000 chars)

**Expected Results:**
- ✅ HTTP 201 Created or 400 Bad Request
- ✅ System either accepts or rejects gracefully
- ✅ No database corruption

---

## Implementation Checklist

For boundary condition testing:

- [ ] Empty file uploads are handled correctly
- [ ] File size limits are enforced
- [ ] MIME type validation works with wildcards
- [ ] Read-only entries block uploads
- [ ] Entry alias validation covers all edge cases
- [ ] Default entry management prevents multiple defaults
- [ ] Resource block switches handle same-block case
- [ ] Version conflict detection works
- [ ] Download ranges handle exact boundaries
- [ ] Invalid ranges return proper 416 errors
- [ ] Missing/corrupt files log appropriate issues
- [ ] Pagination handles zero, large, and invalid values
- [ ] LogEntry state transitions enforce terminal states
- [ ] All error conditions return proper error codes
- [ ] System gracefully handles malformed inputs
- [ ] Database constraints prevent invalid data
- [ ] Long strings are truncated or rejected appropriately
- [ ] Empty values are handled consistently
- [ ] Tests cover both success and failure paths

---

## Test Data Generation

For automated boundary testing, generate:

- Empty files (0 bytes)
- Files at max size limit
- Files exceeding max size by 1 byte
- Files with various MIME types
- Long strings for all text fields
- Invalid characters for pattern-validated fields
- Boundary values for all numeric fields

Use these in both unit tests and Hurl integration tests.
