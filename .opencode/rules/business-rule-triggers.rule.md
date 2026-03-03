# Business Rule Triggers Rule

This document defines the explicit trigger conditions for all business rules in the Reblock system.

---

## Overview

Every business rule has specific trigger conditions that define when it should be applied. This document provides the complete mapping of operations to business rules.

---

## Entry Business Rules

### Rule: Entry Alias Uniqueness

**Rule ID:** `ENTRY_ALIAS_UNIQUE`

**Description:** Entry aliases must be unique among non-invalid entries.

**Trigger Conditions:**
- `POST /entries` - When creating a new entry
- `PUT /entries/:id` - When updating an existing entry's alias
- `PATCH /entries/:id` - When patching an entry's alias

**Pre-checks:**
1. Extract the alias from the request
2. Trim whitespace from the alias
3. If alias is empty string, skip uniqueness check
4. If alias unchanged from current value, skip check

**Validation Logic:**
```typescript
async function checkAliasUniqueness(alias: string, excludeId?: string): Promise<boolean> {
  const trimmed = alias.trim();
  if (trimmed === '') return true;
  
  const existing = await Entry.findOne({
    alias: trimmed,
    isInvalid: { $ne: true },
    ...(excludeId ? { _id: { $ne: excludeId } } : {})
  });
  
  return !existing;
}
```

**Error Response:**
```
Status: 409 Conflict
{
  "error": "alias already exists",
  "code": "ALIAS_EXISTS"
}
```

---

### Rule: Single Default Entry

**Rule ID:** `SINGLE_DEFAULT_ENTRY`

**Description:** Only one entry can be marked as default at any time.

**Trigger Conditions:**
- `POST /entries` - When creating an entry with `isDefault: true`
- `PUT /entries/:id` - When updating `isDefault` to `true`
- `PATCH /entries/:id` - When patching `isDefault` to `true`

**Pre-checks:**
1. Check if request is setting `isDefault: true`
2. If not changing default status, skip

**Action Logic:**
```typescript
async function ensureSingleDefault(excludeId?: string): Promise<void> {
  // Unset default from all other entries
  await Entry.updateMany(
    {
      isDefault: true,
      isInvalid: { $ne: true },
      ...(excludeId ? { _id: { $ne: excludeId } } : {})
    },
    {
      isDefault: false,
      updatedAt: Date.now()
    }
  );
}
```

**Note:** This operation should be done BEFORE setting the new default entry.

---

### Rule: Entry Read-only Check

**Rule ID:** `ENTRY_READ_ONLY`

**Description:** Uploads are blocked for read-only entries.

**Trigger Conditions:**
- `POST /upload/:alias` - Any upload attempt

**Validation Logic:**
```typescript
async function validateEntryNotReadOnly(alias: string): Promise<void> {
  const entry = await Entry.findOne({
    alias: alias.trim(),
    isInvalid: { $ne: true }
  });
  
  if (!entry) {
    throw new Error('Entry not found');
  }
  
  if (entry.uploadConfig?.readOnly) {
    throw new UploadBusinessError('Entry is read-only', 403);
  }
}
```

**Error Response:**
```
Status: 403 Forbidden
{
  "error": "Entry is read-only",
  "code": "ENTRY_READ_ONLY"
}
```

---

## Upload Business Rules

### Rule: File Size Validation

**Rule ID:** `FILE_SIZE_VALIDATION`

**Description:** Uploaded files must not exceed maxFileSize from uploadConfig.

**Trigger Conditions:**
- `POST /upload/:alias` - All upload attempts

**Pre-checks:**
1. Get entry's uploadConfig
2. If no maxFileSize configured, skip
3. Get file size from temp file

**Validation Logic:**
```typescript
function validateFileSize(size: number, uploadConfig?: IUploadConfig): void {
  if (!uploadConfig?.maxFileSize) return;
  
  if (size > uploadConfig.maxFileSize) {
    throw new UploadBusinessError('File too large', 413);
  }
}
```

**Error Response:**
```
Status: 413 Payload Too Large
{
  "error": "File too large",
  "code": "FILE_TOO_LARGE"
}
```

---

### Rule: MIME Type Validation

**Rule ID:** `MIME_TYPE_VALIDATION`

**Description:** Uploaded files must match allowedMimeTypes from uploadConfig.

**Trigger Conditions:**
- `POST /upload/:alias` - All upload attempts

**Pre-checks:**
1. Get entry's uploadConfig
2. If no allowedMimeTypes configured, skip
3. Detect actual MIME type from file content

**Validation Logic:**
```typescript
function validateMimeType(detectedMime: string, uploadConfig?: IUploadConfig): void {
  if (!uploadConfig?.allowedMimeTypes?.length) return;
  
  const isAllowed = uploadConfig.allowedMimeTypes.some(pattern => {
    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, -1);
      return detectedMime.startsWith(prefix);
    }
    return detectedMime === pattern;
  });
  
  if (!isAllowed) {
    throw new UploadBusinessError('File type not allowed', 415);
  }
}
```

**Error Response:**
```
Status: 415 Unsupported Media Type
{
  "error": "File type not allowed",
  "code": "INVALID_MIME_TYPE"
}
```

---

### Rule: Block Deduplication

**Rule ID:** `BLOCK_DEDUPLICATION`

**Description:** Reuse existing blocks when same SHA256 content is uploaded.

**Trigger Conditions:**
- `POST /upload/:alias` - After file validation, before block creation

**Logic:**
```typescript
async function handleBlockDeduplication(
  sha256: string,
  size: number,
  tempFilePath: string
): Promise<IBlock> {
  // Check for existing valid block with same SHA256
  const existingBlock = await Block.findOne({
    sha256,
    isInvalid: { $ne: true }
  });
  
  if (existingBlock) {
    // Increment link count and reuse
    existingBlock.linkCount += 1;
    existingBlock.updatedAt = Date.now();
    await existingBlock.save();
    return existingBlock;
  }
  
  // Create new block (full logic omitted)
  return createNewBlock(sha256, size, tempFilePath);
}
```

**Note:** This is an optimization rule, not an error rule.

---

## Resource Business Rules

### Rule: LinkCount Increment on Create

**Rule ID:** `LINKCOUNT_INCREMENT_CREATE`

**Description:** Increment block's linkCount when a resource references it.

**Trigger Conditions:**
- `POST /resources` - When creating a new resource
- `POST /upload/:alias` - When upload creates a resource

**Action:**
```typescript
async function incrementLinkCount(blockId: ObjectId): Promise<void> {
  await Block.findByIdAndUpdate(
    blockId,
    {
      $inc: { linkCount: 1 },
      updatedAt: Date.now()
    }
  );
}
```

---

### Rule: LinkCount Decrement on Delete

**Rule ID:** `LINKCOUNT_DECREMENT_DELETE`

**Description:** Decrement block's linkCount when a resource referencing it is deleted.

**Trigger Conditions:**
- `DELETE /resources/:id` - When deleting a resource

**Action:**
```typescript
async function decrementLinkCount(blockId: ObjectId): Promise<void> {
  await Block.findByIdAndUpdate(
    blockId,
    {
      $inc: { linkCount: -1 },
      updatedAt: Date.now()
    }
  );
  
  // Ensure linkCount doesn't go negative
  const block = await Block.findById(blockId);
  if (block && block.linkCount < 0) {
    block.linkCount = 0;
    await block.save();
  }
}
```

---

### Rule: Resource Block Update Transaction

**Rule ID:** `RESOURCE_BLOCK_UPDATE_TX`

**Description:** Update resource block atomically with history tracking.

**Trigger Conditions:**
- `PATCH /resources/:id/block` - When updating a resource's block

**Transaction Steps:**
1. Validate both old and new blocks exist and are valid
2. Start MongoDB transaction (if supported)
3. Update resource's block reference
4. Decrement old block's linkCount
5. Increment new block's linkCount
6. Create ResourceHistory record
7. Commit transaction

**Fallback:** If transactions not supported, still execute all steps atomically as possible.

---

## Block Business Rules

### Rule: Block SHA256 Uniqueness

**Rule ID:** `BLOCK_SHA256_UNIQUE`

**Description:** SHA256 must be unique among valid blocks.

**Trigger Conditions:**
- Block creation (during upload or migration)

**Enforcement:**
- Database-level partial unique index: `{ sha256: 1 }` with `partialFilterExpression: { isInvalid: false }`
- Application-level check before creation (defensive)

**Error on Conflict:**
```
Status: 409 Conflict
{
  "error": "Block with this SHA256 already exists",
  "code": "DUPLICATE_SHA256"
}
```

---

### Rule: Orphaned Block Detection

**Rule ID:** `ORPHANED_BLOCK_DETECTION`

**Description:** Detect blocks with linkCount = 0 but isInvalid = false.

**Trigger Conditions:**
- Doctor script execution (`node scripts/doctor.mjs`)

**Detection Query:**
```typescript
const orphanedBlocks = await Block.find({
  linkCount: 0,
  isInvalid: false
});
```

**Action:** Log issue with category `ORPHANED_BLOCK`.

---

## Business Rule Trigger Matrix

| Operation | Rules Triggered |
|-----------|-----------------|
| `POST /entries` | `ENTRY_ALIAS_UNIQUE`, `SINGLE_DEFAULT_ENTRY` |
| `PUT /entries/:id` | `ENTRY_ALIAS_UNIQUE`, `SINGLE_DEFAULT_ENTRY` |
| `DELETE /entries/:id` | (None - just soft delete) |
| `POST /upload/:alias` | `ENTRY_READ_ONLY`, `FILE_SIZE_VALIDATION`, `MIME_TYPE_VALIDATION`, `BLOCK_DEDUPLICATION`, `LINKCOUNT_INCREMENT_CREATE` |
| `POST /resources` | `LINKCOUNT_INCREMENT_CREATE` |
| `PUT /resources/:id` | (None - just update metadata) |
| `PATCH /resources/:id/block` | `RESOURCE_BLOCK_UPDATE_TX`, `LINKCOUNT_DECREMENT_DELETE`, `LINKCOUNT_INCREMENT_CREATE` |
| `DELETE /resources/:id` | `LINKCOUNT_DECREMENT_DELETE` |
| `POST /resources/:id/rollback` | `RESOURCE_BLOCK_UPDATE_TX`, `LINKCOUNT_DECREMENT_DELETE`, `LINKCOUNT_INCREMENT_CREATE` |
| Doctor Script | `ORPHANED_BLOCK_DETECTION`, plus other consistency checks |
| Cleanup Script | (Cleanup rules apply) |

---

## Implementation Checklist

When implementing business rules:

- [ ] Each rule has explicit trigger conditions defined
- [ ] Pre-checks skip rule application when not needed
- [ ] Database-level constraints complement application rules
- [ ] Error responses are consistent and include error codes
- [ ] Transactional operations use database transactions when available
- [ ] Rules are tested in isolation and in combination
- [ ] Rule triggers are logged for debugging
- [ ] Defensive checks prevent negative linkCount
- [ ] Alias uniqueness checks exclude the current entry when updating
- [ ] Default entry management unsets old default before setting new one
- [ ] MIME type validation supports wildcard patterns (type/*)
- [ ] File size validation uses the entry's uploadConfig
- [ ] Read-only check happens before any file processing
- [ ] Block deduplication happens before encryption/storage
