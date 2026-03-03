# Block Storage Path Calculation

**Last Updated**: 2026-03-03  
**Applies to**: All scripts and services handling block storage

---

## Overview

Block storage uses a **HMAC-based path calculation** to ensure security and prevent path enumeration attacks. This document describes the algorithm and implementation details.

---

## Security Rationale

### Why not use raw SHA256 as path?

1. **Path Enumeration Risk**: Raw SHA256 allows attackers to enumerate all files
2. **Content Exposure**: File paths reveal content hash information
3. **Unauthorized Access**: Predictable paths enable unauthorized file access

### HMAC Solution

- **Secret Key Required**: `ENCRYPTION_KEY` from environment
- **Non-deterministic without key**: Same SHA256 produces different paths with different keys
- **Security through obfuscation**: Cannot determine file location without knowing the key

---

## Algorithm

### Step 1: Generate Storage Name

```typescript
function generateStorageName(sha256: string): string {
  const key = Buffer.from(ENCRYPTION_KEY, 'base64');
  return crypto.createHmac('sha256', key).update(sha256).digest('hex');
}
```

**Input**: Original file SHA256 hash (64 hex characters)
**Output**: 64-character hex string (storageName)
**Key**: `ENCRYPTION_KEY` from environment (base64-encoded 32-byte key)

### Step 2: Build Storage Path

```typescript
function getStoragePath(storageName: string): string {
  const prefix1 = storageName.substring(0, 2);      // First 2 chars
  const secondChar = storageName.substring(2, 3);   // 3rd char
  return `${prefix1}/${secondChar}${storageName}`;
}
```

### Step 3: Full Path Construction

```typescript
const blocksDir = process.env.STORAGE_BLOCK_DIR || './storage/blocks';
const fullPath = path.join(blocksDir, getStoragePath(storageName));
```

---

## Path Format

### Structure

```
{STORAGE_BLOCK_DIR}/{prefix1}/{secondChar}{storageName}
```

| Component | Description | Example |
|-----------|-------------|---------|
| `STORAGE_BLOCK_DIR` | Base directory | `storage/blocks` |
| `prefix1` | First 2 chars of storageName | `d9` |
| `secondChar` | 3rd char of storageName | `8` |
| `storageName` | Full HMAC-derived name (64 chars) | `d9fe039360982785b6bbdd916b149c53...` |

### Example

Given:
- SHA256: `abc123...`
- ENCRYPTION_KEY: `base64encodedkey...`
- storageName (HMAC-SHA256): `d9fe039360982785b6bbdd916b149c53e9a01caae6bba1f1c6de3bce5403ea50`

Results in:
```
storage/blocks/d9/8d9fe039360982785b6bbdd916b149c53e9a01caae6bba1f1c6de3bce5403ea50
```

---

## Implementation

### Core Utilities

**Location**: `src/utils/crypto.ts`

```typescript
export function generateStorageName(sha256: string): string {
  const key = getEncryptionKey();  // From env.ENCRYPTION_KEY
  return crypto.createHmac('sha256', key).update(sha256).digest('hex');
}

export function getStoragePath(storageName: string): string {
  const prefix1 = storageName.substring(0, 2);
  const secondChar = storageName.substring(2, 3);
  return `${prefix1}/${secondChar}${storageName}`;
}
```

### Service Usage

**uploadService.ts**, **resourceService.ts**, **migrationService.ts**:

```typescript
import { generateStorageName, getStoragePath } from '../utils/crypto';

// In service methods:
const storageName = generateStorageName(sha256);
const filePath = path.join(blocksDir, getStoragePath(storageName));
```

### Script Usage

**doctor.mjs**, **cleanup.mjs**:

```javascript
function generateStorageName(sha256) {
  const key = Buffer.from(CONFIG.ENCRYPTION_KEY, 'base64');
  return createHmac('sha256', key).update(sha256).digest('hex');
}

function getStoragePath(sha256) {
  const storageName = generateStorageName(sha256);
  const prefix1 = storageName.substring(0, 2);
  const secondChar = storageName.substring(2, 3);
  const relativePath = `${prefix1}/${secondChar}${storageName}`;
  return join(blocksDir, relativePath);
}
```

---

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ENCRYPTION_KEY` | Yes | - | Base64-encoded 32-byte key for HMAC |
| `STORAGE_BLOCK_DIR` | No | `./storage/blocks` | Base directory for block storage |

### Validation

Scripts and services MUST validate `ENCRYPTION_KEY` is configured:

```typescript
if (!CONFIG.ENCRYPTION_KEY) {
  throw new Error('ENCRYPTION_KEY not configured');
}
```

---

## Common Mistakes

### ❌ WRONG: Direct SHA256 Path

```javascript
// DO NOT DO THIS
function getStoragePath(sha256) {
  const prefix = sha256.substring(0, 2);
  return join(blocksDir, prefix, sha256);  // ❌ Missing HMAC
}
```

**Result**: File not found (looking in wrong location)

### ✅ CORRECT: HMAC-based Path

```javascript
// DO THIS
function getStoragePath(sha256) {
  const storageName = generateStorageName(sha256);
  const prefix1 = storageName.substring(0, 2);
  const secondChar = storageName.substring(2, 3);
  return join(blocksDir, prefix1, secondChar + storageName);
}
```

---

## Migration Notes

### From Old Format (if any)

If migrating from a system that used raw SHA256 paths:

1. **Keep old files** in place
2. **Update path calculation** in new code
3. **Gradual migration** on file access
4. **Update detection scripts** to use correct paths

### Detection Scripts Update

Scripts like `resource-report.mjs` and `resource-corrupt.mjs` MUST use HMAC path calculation:

```javascript
// Before (WRONG):
const path = join(blocksDir, sha256.substring(0, 2), sha256);

// After (CORRECT):
const path = getStoragePath(sha256);  // Uses HMAC internally
```

---

## Testing

### Verify Path Calculation

```bash
# Test with known values
node -e "
const crypto = require('crypto');
const sha256 = 'abc123...';
const key = Buffer.from(process.env.ENCRYPTION_KEY, 'base64');
const storageName = crypto.createHmac('sha256', key).update(sha256).digest('hex');
console.log('Storage Name:', storageName);
console.log('Path:', storageName.substring(0, 2) + '/' + storageName.substring(2, 3) + storageName);
"
```

### Verify File Exists

```bash
# After upload, verify file at correct location
ls -la storage/blocks/d9/8d9fe0393...
```

---

## Related Documents

- `business-flows.md` - Upload and download flowcharts
- `module-dependencies.md` - Module structure and imports
- `service-interface.rule.md` - Service implementation rules
- `security.md` - Security best practices

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-03-03 | Initial documentation | System |
| 2026-03-03 | Fixed script implementations | System |
