# Implement Upload Endpoint

Add file upload capability to the resources service.

This MUST strictly comply with ALL `.opencode/rules`.

---

## Endpoint

POST /upload/:alias

Binary body upload:

curl --data-binary @file http://localhost:3000/upload/{alias}

---

## Architecture Constraints (MANDATORY)

Follow layered architecture:

router → service → model

Router MUST NOT:

- access mongoose models
- contain business logic
- compute hashes

Service MUST:

- orchestrate upload lifecycle
- enforce soft-delete filters
- manage timestamps
- update linkCount

---

## Upload Flow

### 1. Validate Entry

Service must:

find entry by alias:

{
  alias,
  isInvalid: { $ne: true }
}

If not found → 404.

---

### 2. Temp Storage

Router streams request body into:

storage/_temp/{random}.upload

NO buffering allowed.

---

### 3. SHA256

Service computes sha256 of temp file.

---

### 4. Block Deduplication

Check:

Block.findOne({
  sha256,
  isInvalid: { $ne: true }
})

IF exists:

- delete temp file
- increment linkCount

IF NOT exists:

- move file to:

storage/_blocks/{hex(0,2)}/{hex(2)}{storageName}

- create block:

{
  sha256,
  size,
  linkCount: 1,
  createdAt,
  updatedAt
}

---

### 5. Create Resource

Create resource referencing:

entry._id
block._id

Inject timestamps via service.

---

## Storage Rules

Directories must auto-create if missing.

---

## Timestamp Rules

Service injects:

createdAt = Date.now()
updatedAt = Date.now()

User cannot control timestamps.

---

## Output

Return created resource JSON.

HTTP 201.

---

## Files To Create

src/services/uploadService.ts
src/routes/uploadRouter.ts

Register router in app.ts:

app.route('/upload', uploadRouter)

---

## DO NOT MODIFY EXISTING MODULES

