# Data Boundaries Rule

This document defines the value boundaries, constraints, and validation rules for all data fields in the Reblock system.

---

## Overview

All field values must adhere to these constraints to ensure:
- Data consistency across implementations
- Proper database indexing
- Predictable behavior
- Security boundaries

---

## Block Field Boundaries

### sha256

| Property | Constraint |
|----------|------------|
| Type | String |
| Format | Hexadecimal (lowercase) |
| Length | Exactly 64 characters |
| Pattern | `^[a-f0-9]{64}$` |
| Example | `"a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0"` |

**Validation:**
```typescript
const sha256Regex = /^[a-f0-9]{64}$/;
if (!sha256Regex.test(sha256)) {
  throw new Error('Invalid SHA256 format');
}
```

### size

| Property | Constraint |
|----------|------------|
| Type | Number |
| Minimum | `0` (empty file allowed) |
| Maximum | `10737418240` (10 GB) |
| Unit | Bytes |
| Integer | Yes (must be whole number) |

**Validation:**
```typescript
if (size < 0 || size > 10 * 1024 * 1024 * 1024) {
  throw new Error('File size out of bounds (0-10GB)');
}
if (!Number.isInteger(size)) {
  throw new Error('Size must be an integer');
}
```

### linkCount

| Property | Constraint |
|----------|------------|
| Type | Number |
| Minimum | `0` |
| Maximum | `2147483647` (2^31 - 1) |
| Integer | Yes |

**Business Rules:**
- Must never be negative
- Automatically incremented/decremented
- `linkCount === 0` indicates orphaned block

---

## Entry Field Boundaries

### name

| Property | Constraint |
|----------|------------|
| Type | String |
| Minimum Length | `1` |
| Maximum Length | `255` |
| Trimmed | Yes (automatically trimmed) |
| Characters | Any Unicode |

**Validation:**
```typescript
const trimmed = name.trim();
if (trimmed.length < 1 || trimmed.length > 255) {
  throw new Error('Name must be 1-255 characters');
}
```

### alias

| Property | Constraint |
|----------|------------|
| Type | String |
| Minimum Length | `0` (empty allowed) |
| Maximum Length | `100` |
| Trimmed | Yes |
| Allowed Characters | `[a-z0-9-_]` (lowercase alphanumeric, dash, underscore) |
| Pattern | `^[a-z0-9-_]*$` |
| Uniqueness | Unique among non-invalid entries |

**Validation:**
```typescript
const aliasRegex = /^[a-z0-9-_]*$/;
const trimmed = alias.trim();
if (trimmed.length > 100) {
  throw new Error('Alias too long (max 100)');
}
if (!aliasRegex.test(trimmed)) {
  throw new Error('Alias can only contain lowercase letters, numbers, dash, and underscore');
}
```

### description

| Property | Constraint |
|----------|------------|
| Type | String |
| Maximum Length | `2000` |
| Default | `""` (empty string) |

### order

| Property | Constraint |
|----------|------------|
| Type | Number |
| Minimum | `0` |
| Maximum | `2147483647` |
| Optional | Yes |

### uploadConfig.maxFileSize

| Property | Constraint |
|----------|------------|
| Type | Number |
| Minimum | `1` |
| Maximum | `10737418240` (10 GB) |
| Unit | Bytes |
| Optional | Yes |

### uploadConfig.allowedMimeTypes

| Property | Constraint |
|----------|------------|
| Type | Array of Strings |
| Maximum Items | `100` |
| Each Item | Valid MIME type or wildcard pattern |
| Wildcards | `type/*` pattern allowed (e.g., `image/*`) |
| Optional | Yes |

**Valid MIME type patterns:**
- `image/png` (specific type)
- `image/*` (wildcard subtype)
- `application/octet-stream` (generic binary)

---

## Resource Field Boundaries

### name

| Property | Constraint |
|----------|------------|
| Type | String |
| Maximum Length | `500` |
| Default | `""` (empty string) |
| Trimmed | Yes |

### mime

| Property | Constraint |
|----------|------------|
| Type | String |
| Maximum Length | `100` |
| Format | Valid MIME type |
| Optional | Yes |

**Example valid values:**
- `image/png`
- `video/mp4`
- `application/pdf`
- `text/plain`

### category

| Property | Constraint |
|----------|------------|
| Type | String |
| Maximum Length | `100` |
| Trimmed | Yes |
| Optional | Yes |

### description

| Property | Constraint |
|----------|------------|
| Type | String |
| Maximum Length | `2000` |
| Default | `""` (empty string) |

### clientIp

| Property | Constraint |
|----------|------------|
| Type | String |
| Format | IPv4 or IPv6 address |
| Maximum Length | `45` (IPv6 max length) |
| Optional | Yes |

### userAgent

| Property | Constraint |
|----------|------------|
| Type | String |
| Maximum Length | `1000` |
| Optional | Yes |

### uploadDuration

| Property | Constraint |
|----------|------------|
| Type | Number |
| Minimum | `0` |
| Maximum | `86400000` (24 hours in ms) |
| Unit | Milliseconds |
| Optional | Yes |

---

## ResourceHistory Field Boundaries

### action

| Property | Constraint |
|----------|------------|
| Type | String |
| Allowed Values | `"swap"`, `"rollback"` |
| Enum | Yes |

### changedBy

| Property | Constraint |
|----------|------------|
| Type | String |
| Maximum Length | `255` |
| Optional | Yes |

### reason

| Property | Constraint |
|----------|------------|
| Type | String |
| Maximum Length | `1000` |
| Optional | Yes |

### requestId

| Property | Constraint |
|----------|------------|
| Type | String |
| Maximum Length | `100` |
| Optional | Yes |

---

## LogEntry Field Boundaries

### level

| Property | Constraint |
|----------|------------|
| Type | String |
| Allowed Values | `"CRITICAL"`, `"ERROR"`, `"WARNING"`, `"INFO"` |
| Enum | Yes |

### category

| Property | Constraint |
|----------|------------|
| Type | String |
| Allowed Values | See LogCategory enum |
| Enum | Yes |

**Valid categories:**
- `ORPHANED_BLOCK`
- `MISSING_FILE`
- `DUPLICATE_SHA256`
- `LINKCOUNT_MISMATCH`
- `FILE_SIZE_MISMATCH`
- `CLEANUP_ACTION`
- `CLEANUP_ERROR`
- `RUNTIME_ERROR`
- `DATA_INCONSISTENCY`

### status

| Property | Constraint |
|----------|------------|
| Type | String |
| Allowed Values | `"open"`, `"acknowledged"`, `"resolved"`, `"ignored"` |
| Enum | Yes |

### suggestedAction

| Property | Constraint |
|----------|------------|
| Type | String |
| Maximum Length | `2000` |
| Optional | Yes |

### resolution

| Property | Constraint |
|----------|------------|
| Type | String |
| Maximum Length | `2000` |
| Optional | Yes |

### resolvedBy

| Property | Constraint |
|----------|------------|
| Type | String |
| Maximum Length | `255` |
| Optional | Yes |

### recoverySteps

| Property | Constraint |
|----------|------------|
| Type | Array of Strings |
| Maximum Items | `50` |
| Each Step Max Length | `500` |
| Optional | Yes |

### details

| Property | Constraint |
|----------|------------|
| Type | Object |
| Maximum Depth | `5` levels |
| Maximum Keys | `100` |
| Each Value Max Length | `10000` (string values) |
| Optional | Yes |

---

## Pagination Boundaries

### limit

| Property | Constraint |
|----------|------------|
| Type | Number |
| Minimum | `1` |
| Maximum | `200` |
| Default | `50` |
| Integer | Yes |

### offset

| Property | Constraint |
|----------|------------|
| Type | Number |
| Minimum | `0` |
| Maximum | `100000` |
| Default | `0` |
| Integer | Yes |

---

## Environment Configuration Boundaries

### STORAGE_BLOCK_DIR

| Property | Constraint |
|----------|------------|
| Type | String |
| Maximum Length | `1000` |
| Must exist | Yes (created if not exists) |
| Must be writable | Yes |

### STORAGE_TEMP_DIR

| Property | Constraint |
|----------|------------|
| Type | String |
| Maximum Length | `1000` |
| Must exist | Yes (created if not exists) |
| Must be writable | Yes |

### ENCRYPTION_KEY

| Property | Constraint |
|----------|------------|
| Type | String (Base64 encoded) |
| Decoded Length | Exactly `32` bytes (256 bits) |
| Format | Base64 |

**Validation:**
```typescript
const keyBuffer = Buffer.from(encryptionKey, 'base64');
if (keyBuffer.length !== 32) {
  throw new Error('Encryption key must be 32 bytes (256 bits)');
}
```

### LOG_TTL_DAYS

| Property | Constraint |
|----------|------------|
| Type | Number |
| Minimum | `1` |
| Maximum | `365` |
| Default | `90` |
| Integer | Yes |

---

## Implementation Checklist

When implementing field validation:

- [ ] All string fields have length constraints
- [ ] SHA256 is validated for format and length
- [ ] File sizes are bounded (0-10GB)
- [ ] Numeric fields are integers when required
- [ ] Enum fields have proper validation
- [ ] Alias uses only allowed characters
- [ ] Pagination bounds are enforced (1-200 limit, 0-100000 offset)
- [ ] Encryption key is validated for 32 bytes
- [ ] All inputs are trimmed before validation
- [ ] Validation happens at service layer before persistence
- [ ] Error messages clearly indicate which constraint was violated
- [ ] Database schema enforces constraints at storage level

---

## Error Messages

### Field Validation Error Format

```typescript
{
  error: "Field validation failed",
  code: "VALIDATION_ERROR",
  details: {
    field: "alias",
    value: "Invalid Alias!",
    reason: "Alias can only contain lowercase letters, numbers, dash, and underscore",
    constraint: "^[a-z0-9-_]*$"
  }
}
```

**HTTP Status Code:** `400 Bad Request`
