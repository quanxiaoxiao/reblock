# Multi-Language Implementation Technical Specifications

## 1. Database Schema Requirements and Indexing Strategies

### Block Collection/Entity Structure

The Block entity stores the actual content blocks encrypted on the file system:

```javascript
Block: {
  _id: ObjectId,                 // MongoDB ObjectId; must be equivalent type in other DBs
  sha256: String,                // SHA-256 hash of the original content before encryption
  size: Number,                  // Size of the content in bytes
  linkCount: Number,             // Number of active resources referencing this block
  createdAt: Number,             // Unix timestamp in milliseconds when created
  updatedAt: Number,             // Unix timestamp in milliseconds when updated
  isInvalid: Boolean,            // Soft delete flag - defaults to false to indicate active
  invalidatedAt: Number,         // Unix timestamp when marked as inactive (millisecond timestamp)
}
```

**Indexing Requirements**:
- `{isInvalid: 1}` with partial filter to efficiently query valid (non-soft-deleted) blocks
- `{sha256: 1}` with partially unique constraint where `isInvalid: false` to prevent duplicate valid blocks
- `{sha256: 1, isInvalid: 1}` composition may improve lookup performance

### Resource Collection/Entity Structure

The Resource entity links block IDs with entry IDs and contains additional metadata:

```javascript
Resource: {
  _id: ObjectId,
  block: ObjectId,               // Foreign key reference to Block._id containing the encrypted data
  entry: ObjectId,               // Foreign key reference to Entry._id that owns this resource
  name: String,                  // Optional display name for the resource (default: "")
  mime: String,                  // MIME type of the content (derived from uploaded file)
  description: String,           // Optional extended description (default: "")
  category: String,              // Optional classification tag for grouping resources
  createdAt: Number,             // Creation timestamp (Unix millis)
  updatedAt: Number,             // Last modification timestamp (Unix millis)
  lastAccessedAt: Number,        // Timestamp of the last successful download access
  isInvalid: Boolean,            // Soft delete flag - defaults to false (equivalent to soft delete)
  invalidatedAt: Number,         // Unix timestamp when marked as invalid
  clientIp: String,              // IP address of the uploading client
  userAgent: String,             // User-Agent header string from the upload request
  uploadDuration: Number,        // Duration of upload processing in milliseconds
}
```

**Indexing Requirements**:
- `{block: 1}`, `{entry: 1}`, `{isInvalid: 1}` individually for efficient joins
- `{entry: 1, isInvalid: 1, createdAt: -1}` for querying resources within a specific entry ordered by creation date
- `{isInvalid: 1, lastAccessedAt: 1}` for access pattern queries
- `{createdAt: -1, _id: -1}` for stable pagination (stable sort order for pagination)

### Entry Collection/Entity Structure

The Entry entity represents logical partitions/buckets with optional upload restrictions:

```javascript
Entry: {
  _id: ObjectId,
  name: String,                  // Display name of the entry for UI
  alias: String,                 // Short identifier used in upload URLs (unique among active entries)
  description: String,           // Extended description of the entry
  isDefault: Boolean,            // Flag indicating if this is the default entry (only one active default)
  order: Number,                 // Display order hint for UI organization
  createdAt: Number,             // Creation timestamp (Unix millis)
  updatedAt: Number,             // Last modification timestamp (Unix millis)
  isInvalid: Boolean,            // Soft delete flag - defaults to false for active entries
  invalidatedAt: Number,         // Unix timestamp when marked as invalid
  uploadConfig: {                // Optional configuration for upload restrictions
    maxFileSize: Number,         // Maximum allowed file size in bytes (no limit if undefined)
    allowedMimeTypes: [String],  // Array of allowed MIME types, supports wildcards (image/*)
    readOnly: Boolean           // If true, prevents further uploads to this entry (default: false)
  }
}
```

**Indexing Requirements**:
- `{isInvalid: 1}`, `{alias: 1}`, `{isDefault: 1}` for basic query optimizations
- `{alias: 1, isInvalid: 1}` with unique constraint to enforce alias uniqueness among active entries
- `{isDefault: 1, isInvalid: 1}` with unique constraint where `isDefault: true AND isInvalid: false` for at most one default entry that's active

### ResourceHistory Collection/Entity Structure

Tracks historic block assignments for rollback capability and audit trails:

```javascript
ResourceHistory: {
  _id: ObjectId,
  resourceId: ObjectId,          // Reference to the affected Resource._id
  fromBlockId: ObjectId,         // Previous block referenced by this resource 
  toBlockId: ObjectId,           // New block reference assignment after the change
  action: String,                // Values: "swap", "rollback" - type of assignment operation
  changedAt: Number,             // Timestamp when the change occurred (milliseconds)
  changedBy: String,             // User or system identity that initiated the change
  reason: String,                // Human-readable reason/explanation for the change
  requestId: String,             // HTTP request ID for correlation and traceability
  rollbackable: Boolean,         // True if this history entry supports rollback operations
}
```

**Indexing Requirements**:
- `{resourceId: 1, changedAt: -1}` for historical timeline by resource
- `{toBlockId: 1, changedAt: -1}` for tracking when blocks became assigned to resources

## 2. API Endpoint Contracts and Request/Response Specifications

### Upload Endpoints

#### POST `/upload/:alias`
Uploads content to an entry designated by alias and performs content deduplication based on SHA-256 hash.

**Parameters**:
- `alias` (path parameter): Entry alias to upload content to
- `name` (query parameter, optional): Override filename in resource metadata

**Request Body**: Raw file binary data or multipart form data

**Response**: Resource object with full metadata about the uploaded content

**Implementation Requirements**:
1. Locate the entry by `:alias` matching criteria of `isInvalid != true` (only valid entries)
2. Validate file size against `uploadConfig.maxFileSize` constraint (cheap — early rejection)
3. Calculate SHA-256 hash of input payload (expensive — only after size check passes)
4. Execute remaining validation checks:
   - Determine MIME type vs validate against `uploadConfig.allowedMimeTypes` list
   - Check entry is not marked `uploadConfig.readOnly` mode
5. Conduct lookup for existing block with the same calculated SHA-256 hash (where `isInvalid = false`)
6. On match: increment block's linkCount without storing duplicate
7. On no match: encrypt content with AES-256-CTR algorithm and store to secure location
8. Create new Resource record linking the block and entry IDs
9. Utilize HMAC-SHA256 of `sha256` digest to compute filesystem storage path
10. Respond with resource entity containing full upload details and metadata

#### GET `/resources/:id/history`
Returns the historical record of block association changes for a specific resource

**Response**: Array of history entities describing all previous block assignments to this resource

## 3. Security Specifications: Cryptography and Storage

### Secure Storage Path Calculation

To protect block storage paths from enumeration attacks and prediction, a HMAC-based storage path determination is implemented:

1. **Calculate storage name from SHA-256 hash of content**
   ```pseudo
   function generateStorageName(originalSha256) {
       // Decode encryption key from base64 environment variable
       const encryptionKey = base64Decode(env.ENCRYPTION_KEY);
       return hmac_sha256(encryptionKey, originalSha256);
   }
   ```

2. **Construct filesystem path from storage name**
   ```pseudo
   function getFileSystemPath(storageName) {
       const prefix1 = storageName.substring(0, 2);
       const secondChar = storageName.substring(2, 3);
       return `${prefix1}/${secondChar}${storageName}`;
   }
   ```
   
   Example:
   - Original SHA-256: `abc...` (64-character hexadecimal string)
   - Storage name (HMAC result): `d9fe039360982785b6bbdd916b149c53e9a01caae6bba1f1c6de3bce5403ea50` 
   - File path segment: `d9/8d9fe039360982785b6bbdd916b149c53e9a01caae6bba1f1c6de3bce5403ea50`
   - Final physical path: `{STORAGE_BLOCKS_DIR}/d9/8d9fe0...`

### IV Generation for Encryption Operations

For each block, initialization vectors (IV) are derived from MongoDB ObjectIds:

```pseudo
function deriveIVFromBlockId(blockId) {
    // Obtain 12-byte raw ObjectId and pad with 4 zero bytes to reach 16-byte requirement
    const objectIdBytes = extractRawBytes(blockId);  // Extract raw BSON ObjectId bytes
    return concatenate(objectIdBytes, new Uint8Array([0, 0, 0, 0]));  // 12 + 4 = 16 bytes total
}
```

This ensures each block receives a deterministic but unique IV that can be reproduced solely from the ObjectId.

### Encryption Process Sequence

During storage of new content blocks:
1. Derive the initialization vector using `deriveIVFromBlockId()` with a new ObjectId instance
2. Employ AES-256-CTR encryption mode using the environment-configured `ENCRYPTION_KEY` (decoded from base64) with the computed IV
3. Store the resulting ciphertext to the filesystem calculated via `getFileSystemPath(generateStorageName(...))`

### Decryption Process Sequence

During content retrieval via downloads:
1. Retrieve the SHA-256 hash from the referenced Block document associated with the Resource
2. Recompute storage path using `getFileSystemPath(generateStorageName(sha256))`
3. Derive the IV again using the Block's `_id` ObjectId
4. Decrypt with AES-256-CTR using the environment-defined key and computed initialization vector

## 4. State Management and Lifecycle Requirements

### Soft Deletion Pattern

Rather than removing records permanently from the database, the system implements a soft-delete pattern using the `isInvalid` field:

- `POST /entries`, `POST /resources`, `POST /upload`: Initialize `isInvalid` to `false`
- `DELETE /entries/:id`, `DELETE /resources/:id`: Set `isInvalid` to `true`, plus record `invalidatedAt` timestamp

Database queries should filter using `isInvalid: { $ne: true }` or `isInvalid != true` to exclude soft-deleted records from consideration.

### Resource-Block Reference Count Management

The system maintains reference counts to safely clean up unused blocks:

- When a new Resource is created and references a Block, increment `Block.linkCount` by 1
- When a Resource is soft-deleted while referencing a Block, decrement `Block.linkCount` by 1
- Blocks with `linkCount === 0` and simultaneously `isInvalid === false` are classified as "orphaned" 
- Periodic cleanup processes identify orphaned blocks, soft-delete them, and remove associated files

This guarantees that blocks shared among multiple resources won't be prematurely cleared and files are only removed when the final reference is eliminated.

## 5. Transaction Considerations and Atomic Operations

Some critical operations implement atomicity using database-level primitives:

- Utilize database-level atomic increment/decrement operators for managing linkCount
- In transaction-unsupported environments, design operations for idempotency or leverage unique constraints and conflict errors as consistency mechanisms
- The block creation with unique SHA-256 constraint acts as a synchronization point for deduplication during upload processes

## 6. Environment Configuration Requirements

Essential environment variables for core system operation:

| Variable | Purpose | Example |
|----------|---------|---------|
| `ENCRYPTION_KEY` | Base64-encoded 32-byte AES-256 encryption key | `MjM0NjI0NzA3NDE1MjA2NTUzMzI0NjMwNjgyNjg4OTExNDIzMDY5NjIyMzYzMzIzMjE1OTA3NDA5OA==` |
| `STORAGE_BLOCK_DIR` | Directory path where encrypted blocks are stored | `./storage/blocks` |
| `STORAGE_TEMP_DIR` | Directory for temporary file storage during uploads | `./storage/temp` |
| `MONGO_URI` | MongoDB connection string | `mongodb://localhost:27017/reblock` |
| `LOG_TTL_DAYS` | Days to retain log entries before automatic deletion | `90` |

This specification serves as the authoritative reference for implementing the Reblock service across alternative programming languages while preserving compatibility at both API and business logic layers.