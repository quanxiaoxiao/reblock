# Business Flows

This document describes the key business flows in the Reblock service.

---

## Table of Contents

1. [File Upload Flow](#file-upload-flow)
2. [File Download Flow](#file-download-flow)
3. [Range Request / Streaming Flow](#range-request--streaming-flow)
4. [Delete Flow](#delete-flow)
5. [Block Deduplication Flow](#block-deduplication-flow)
6. [Doctor Check Flow](#doctor-check-flow)
7. [Cleanup Flow](#cleanup-flow)

---

## File Upload Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Upload Process                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Client                                                                    │
│    │                                                                     │
│    │ POST /upload/:alias (multipart/form-data)                          │
│    ▼                                                                     │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ uploadRouter                                                       │   │
│  │   • Validates multipart form data                                │   │
│  │   • Saves file to temp directory                                 │   │
│  │   • Calls uploadService.processUpload()                          │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│    │                                                                     │
│    ▼                                                                     │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ UploadService.processUpload()                                    │   │
│  │                                                                    │   │
│  │  1. validateEntryWithConfig(alias)                               │   │
│  │     ├─ Find entry by alias                                        │   │
│  │     ├─ Check not soft-deleted                                    │   │
│  │     └─ Check not read-only                                        │   │
│  │                                                                    │   │
│  │  2. computeSHA256(tempFilePath)                                   │   │
│  │     └─ Stream file through SHA256 hasher                         │   │
│  │                                                                    │   │
│  │  3. validateFileSize(size, uploadConfig)                         │   │
│  │     └─ Throw if exceeds maxFileSize                               │   │
│  │                                                                    │   │
│  │  4. detectMimeType(tempFilePath)                                 │   │
│  │     └─ Use file-type library                                      │   │
│  │                                                                    │   │
│  │  5. validateMimeType(mime, uploadConfig)                         │   │
│  │     └─ Check against allowedMimeTypes                            │   │
│  │                                                                    │   │
│  │  6. handleBlockDeduplication(sha256, size, tempFilePath)        │   │
│  │     ├─ Find existing block with same SHA256                      │   │
│  │     ├─ If found: increment linkCount, reuse block                │   │
│  │     └─ If not found: encrypt & save new block                    │   │
│  │                                                                    │   │
│  │  7. createResource(entry, block, name, mime)                     │   │
│  │     └─ Create Resource record with timestamps                    │   │
│  │                                                                    │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│    │                                                                     │
│    ▼                                                                     │
│  Return: { resource, block, isNewBlock }                                │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Step Details

#### 1. Validate Entry

```typescript
async validateEntryWithConfig(alias: string): Promise<IEntry> {
  const entry = await Entry.findOne({
    alias,
    isInvalid: { $ne: true }
  });

  if (!entry) {
    throw new UploadBusinessError('Entry not found', 404);
  }

  if (entry.uploadConfig?.readOnly) {
    throw new UploadBusinessError('Entry is read-only', 403);
  }

  return entry;
}
```

#### 2. Block Deduplication

```typescript
async handleBlockDeduplication(sha256: string, size: number, tempFilePath: string): Promise<IBlock> {
  // Check if block with same SHA256 exists
  const existingBlock = await Block.findOne({ sha256, isInvalid: false });

  if (existingBlock) {
    // Reuse existing block
    existingBlock.linkCount += 1;
    existingBlock.updatedAt = Date.now();
    await existingBlock.save();
    return existingBlock;
  }

  // Create new block with encryption
  const iv = generateIV(new Types.ObjectId());
  // HMAC-SHA256 based storage path (see storage-path-calculation.md)
  const storageName = generateStorageName(sha256);
  const blockPath = getStoragePath(storageName);

  // Encrypt and save
  const encryptStream = createEncryptStream(iv);
  const writeStream = createWriteStream(blockPath);
  await pipeline(createReadStream(tempFilePath), encryptStream, writeStream);

  // Clean up temp file
  await fs.unlink(tempFilePath);

  // Create block record
  const block = new Block({
    sha256,
    size,
    linkCount: 1,
    createdAt: Date.now(),
    updatedAt: Date.now()
  });
  return block.save();
}
```

---

## File Download Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Download Process                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Client                                                                    │
│    │                                                                     │
│    │ GET /resources/:id/download                                         │
│    ▼                                                                     │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ resourceRouter.download()                                         │   │
│  │   • Extract resource ID from params                              │   │
│  │   • Parse Range header if present                                │   │
│  │   • Call resourceService.download()                             │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│    │                                                                     │
│    ▼                                                                     │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ ResourceService.download()                                        │   │
│  │                                                                    │   │
│  │  1. Find resource & populate block                               │   │
│  │     └─ Filter by isInvalid: false                                │   │
│  │                                                                    │   │
│  │  2. Validate block exists & is valid                             │   │
│  │                                                                    │   │
│  │  3. Generate storage path & IV                                    │   │
│  │     ├─ storageName = HMAC-SHA256(sha256)                         │   │
│  │     │   (See: storage-path-calculation.md)                       │   │
│  │     └─ iv = generateIV(block._id)                                │   │
│  │                                                                    │   │
│  │  4. Check file exists                                             │   │
│  │     └─ If missing: log issue & throw error                       │   │
│  │                                                                    │   │
│  │  5. Handle Range request                                          │   │
│  │     └─ Calculate start/end/size                                   │   │
│  │                                                                    │   │
│  │  6. Update lastAccessedAt                                         │   │
│  │                                                                    │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│    │                                                                     │
│    ▼                                                                     │
│  Return: DownloadResult { filePath, mime, size, iv, ... }              │
│                                                                          │
│  Router streams:                                                         │
│    • Decrypt with createDecryptStream(iv)                              │
│    • Pipe to response                                                   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Encryption Details

Files are encrypted using **AES-256-CTR**:

```typescript
// Encryption
const iv = generateIV(blockId); // IV derived from block ObjectId
const cipher = crypto.createCipheriv('aes-256-ctr', encryptionKey, iv);
const encryptStream = createEncryptStream(iv);

// Decryption
const decipher = crypto.createDecipheriv('aes-256-ctr', encryptionKey, iv);
const decryptStream = createDecryptStream(iv);

// With offset (for Range requests)
const decipher = crypto.createDecipheriv('aes-256-ctr', encryptionKey, iv);
decipher.setAutoPadding(false);
// Skip first 'offset' bytes
```

---

## Range Request / Streaming Flow

```
Client Request:
  Range: bytes=0-1023

Response:
  HTTP/1.1 206 Partial Content
  Content-Type: video/mp4
  Content-Length: 1024
  Content-Range: bytes 0-1023/2048
  Accept-Ranges: bytes
```

### Processing

```typescript
async download(id: string, range?: { start: number; end: number }): Promise<DownloadResult> {
  // ... validation ...

  let rangeInfo: { start: number; end: number; size: number };
  if (range) {
    // Validate range
    if (range.start >= block.size || range.end >= block.size) {
      throw new DownloadError('Range not satisfiable', 416);
    }
    rangeInfo = {
      start: range.start,
      end: Math.min(range.end, block.size - 1),
      size: range.end - range.start + 1
    };
  } else {
    rangeInfo = { start: 0, end: block.size - 1, size: block.size };
  }

  return {
    filePath,
    size: rangeInfo.size,
    totalSize: block.size,
    range: { start: rangeInfo.start, end: rangeInfo.end },
    iv,
    // ...
  };
}
```

### Router Stream Response

```typescript
router.get('/:id/download', async (c) => {
  const result = await resourceService.download(id, range);

  const decryptStream = result.range
    ? createDecryptStreamWithOffset(result.iv, result.range.start)
    : createDecryptStream(result.iv);

  const readStream = createReadStream(result.filePath, {
    start: result.range?.start,
    end: result.range?.end
  });

  return new Response(readStream.pipe(decryptStream), {
    status: result.range ? 206 : 200,
    headers: {
      'Content-Type': result.mime,
      'Content-Length': result.size.toString(),
      'Accept-Ranges': 'bytes',
      ...(result.range && {
        'Content-Range': `bytes ${result.range.start}-${result.range.end}/${result.totalSize}`
      })
    }
  });
});
```

---

## Delete Flow

### Resource Delete

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Resource Delete Flow                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Client: DELETE /resources/:id                                          │
│                                                                          │
│  resourceRouter.delete()                                                 │
│    │                                                                     │
│    ▼                                                                     │
│  ResourceService.delete(id)                                              │
│    │                                                                     │
│    │  1. Find resource (filter: isInvalid != true)                     │
│    │     └─ Return null if not found                                    │
│    │                                                                     │
│    │  2. Decrement block linkCount                                      │
│    │     Block.findByIdAndUpdate(resource.block, {                     │
│    │       $inc: { linkCount: -1 },                                     │
│    │       updatedAt: Date.now()                                         │
│    │     })                                                             │
│    │                                                                     │
│    │  3. Soft delete resource                                            │
│    │     Resource.findByIdAndUpdate(id, {                                │
│    │       isInvalid: true,                                             │
│    │       invalidatedAt: Date.now(),                                   │
│    │       updatedAt: Date.now()                                        │
│    │     }, { new: true })                                             │
│    │                                                                     │
│    └─                                                                    │
│                                                                          │
│  Return: Deleted resource object                                         │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Entry Delete

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       Entry Delete Flow                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Client: DELETE /entries/:id                                            │
│                                                                          │
│  entryRouter.delete()                                                    │
│    │                                                                     │
│    ▼                                                                     │
│  EntryService.delete(id)                                                │
│    │                                                                     │
│    │  1. Soft delete entry only                                          │
│    │     (Resources are NOT automatically deleted)                      │
│    │                                                                     │
│    │  Entry.findByIdAndUpdate(id, {                                      │
│    │      isInvalid: true,                                              │
│    │      invalidatedAt: Date.now(),                                    │
│    │      updatedAt: Date.now()                                         │
│    │  }, { new: true })                                                 │
│    │                                                                     │
│    └─                                                                    │
│                                                                          │
│  ⚠️  Result: Resources become "orphaned" (entry reference invalid)       │
│     Use doctor script to detect orphaned resources                       │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Block Deduplication Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Block Deduplication Flow                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Upload file with SHA256 = "abc123..."                                  │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ Check: Block.findOne({ sha256: "abc123...", isInvalid: false }) │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│    │                                                                     │
│    ├──→ Found (linkCount: 5)                                            │
│    │    │                                                                │
│    │    │  Increment linkCount                                          │
│    │    │  Block.updateOne({ $inc: { linkCount: 1 } })                 │
│    │    │                                                                │
│    │    └──→ Return existing block                                      │
│    │         (File NOT duplicated)                                      │
│    │                                                                     │
│    └──→ Not found                                                       │
│         │                                                                │
│         │  1. Generate IV from new ObjectId                             │
│         │  2. Create storage name: SHA256 + extension                   │
│         │  3. Encrypt file with AES-256-CTR                             │
│         │  4. Save to storage/blocks/                                    │
│         │  5. Create Block record with linkCount: 1                    │
│         │                                                                │
│         └──→ Return new block                                           │
│                                                                          │
│  Result: Same content → Same block → Storage saved!                     │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Doctor Check Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Doctor Check Flow                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  $ node scripts/doctor.mjs                                              │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ 1. Iterate all blocks (filter: isInvalid != true)               │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│    │                                                                     │
│    ▼                                                                     │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ For each block, check:                                           │   │
│  │                                                                    │   │
│  │ A. LinkCount Mismatch                                            │   │
│  │    ├─ Count resources referencing this block                     │   │
│  │    └─ If actual != recorded: LOG ISSUE                           │   │
│  │                                                                    │   │
│  │ B. Orphaned Block                                                │   │
│  │    ├─ If linkCount == 0 AND isInvalid == false                   │   │
│  │    └─ LOG ISSUE                                                  │   │
│  │                                                                    │   │
│  │ C. Missing File                                                  │   │
│  │    ├─ Check: fs.access(storagePath)                              │   │
│  │    └─ If ENOENT: LOG ISSUE                                       │   │
│  │                                                                    │   │
│  │ D. Duplicate SHA256                                              │   │
│  │    ├─ Aggregate: group by sha256, count > 1                      │   │
│  │    └─ For each duplicate: LOG ISSUE                              │   │
│  │                                                                    │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│    │                                                                     │
│    ▼                                                                     │
│  Output: List of detected issues                                        │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Issue Types Detected

| Issue Type           | Detection Logic                          |
|---------------------|------------------------------------------|
| LINKCOUNT_MISMATCH  | resource count ≠ block.linkCount         |
| ORPHANED_BLOCK      | linkCount == 0 && isInvalid == false    |
| MISSING_FILE        | fs.access fails (ENOENT)                |
| DUPLICATE_SHA256    | Multiple blocks with same sha256        |

---

## Cleanup Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Cleanup Flow                                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  $ node scripts/cleanup.mjs --preview    # Show what would be cleaned   │
│  $ node scripts/cleanup.mjs --execute    # Actually clean up            │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ 1. Find orphaned blocks                                          │   │
│  │    Block.find({ linkCount: 0, isInvalid: false })               │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│    │                                                                     │
│    ▼                                                                     │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ For each orphaned block:                                          │   │
│  │                                                                    │   │
│  │ 2. Check age (daysSinceCreation > threshold)                    │   │
│  │                                                                    │   │
│  │ 3. If --preview:                                                 │   │
│  │      Show what would be deleted                                  │   │
│  │                                                                    │   │
│  │ 4. If --execute:                                                 │   │
│  │      a. Soft delete block                                        │   │
│  │         Block.updateOne({                                        │   │
│  │           _id: block._id,                                        │   │
│  │           { isInvalid: true, invalidatedAt: Date.now() }        │   │
│  │         })                                                        │   │
│  │                                                                    │   │
│  │      b. Delete physical file                                     │   │
│  │         fs.unlink(storagePath)                                   │   │
│  │                                                                    │   │
│  │      c. Log cleanup action                                       │   │
│  │         logService.logCleanupAction({...})                       │   │
│  │                                                                    │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  Configurable threshold: --days (default: 30)                           │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Checklist

When implementing flows, ensure:

- [ ] Upload validates entry config before processing
- [ ] Block deduplication reuses existing blocks
- [ ] LinkCount is incremented/decremented correctly
- [ ] Files are encrypted with AES-256-CTR
- [ ] IV is derived from block ObjectId
- [ ] Delete uses soft delete (isInvalid flag)
- [ ] Doctor checks all issue types
- [ ] Cleanup respects age threshold
- [ ] All operations log to LogService where appropriate
