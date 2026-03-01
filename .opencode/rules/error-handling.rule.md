# Error Handling Rule

This document defines the error handling patterns for the Reblock service.

---

## Error Types

### Base Error Classes

```typescript
// Service-level business errors
class BusinessError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code?: string
  ) {
    super(message);
    this.name = 'BusinessError';
  }
}

// Upload-specific errors
class UploadBusinessError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message);
    this.name = 'UploadBusinessError';
  }
}

// Download-specific errors
class DownloadError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code?: string
  ) {
    super(message);
    this.name = 'DownloadError';
  }
}
```

---

## HTTP Status Codes

| Status Code | Usage                          | Description                          |
|-------------|--------------------------------|--------------------------------------|
| 200         | Success                        | GET/PUT/DELETE successful            |
| 201         | Created                        | POST resource created                |
| 400         | Client Error                   | Validation error, bad request         |
| 403         | Forbidden                      | Read-only, access denied             |
| 404         | Not Found                      | Resource not found                   |
| 409         | Conflict                       | Duplicate alias, constraint violation|
| 413         | Payload Too Large              | File too large                       |
| 415         | Unsupported Media Type         | Invalid MIME type                    |
| 416         | Range Not Satisfiable          | Invalid byte range for download      |
| 500         | Server Error                   | Internal error                       |

---

## Error Response Format

### Standard Error

```typescript
interface ErrorResponse {
  error: string;    // Human-readable message
  code?: string;   // Programmatic error code
}
```

### Validation Error (Zod)

```typescript
interface ValidationErrorResponse {
  error: string;
  details?: {
    field: string;
    message: string;
  }[];
}
```

---

## Error Codes

### Service Error Codes

| Code                | HTTP Status | Description                              |
|---------------------|-------------|------------------------------------------|
| NOT_FOUND           | 404         | Resource not found                       |
| BLOCK_NOT_FOUND     | 404         | Block not found or invalid               |
| FILE_MISSING        | 404         | Physical file missing from storage       |
| INVALID_STATE       | 400         | Resource in invalid state               |
| RANGE_INVALID       | 416         | Invalid byte range request               |
| ALREADY_EXISTS      | 409         | Resource already exists (alias, etc.)    |
| CONSTRAINT_VIOLATION| 409         | Database constraint violated             |
| FILE_TOO_LARGE      | 413         | File exceeds max size                   |
| INVALID_MIME_TYPE   | 415         | MIME type not allowed                   |
| READ_ONLY           | 403         | Cannot modify read-only resource         |

---

## Error Handling by Service

### BlockService

```typescript
// No custom errors - returns null for not found
async getById(id: string): Promise<IBlock | null> {
  return Block.findOne({ _id: id, isInvalid: { $ne: true } });
}

async delete(id: string): Promise<IBlock | null> {
  // Returns null if not found (soft delete doesn't exist)
  return Block.findByIdAndUpdate(...);
}
```

### EntryService

```typescript
async create(entryData: Partial<IEntry>): Promise<IEntry> {
  // Check alias uniqueness
  if (entryData.alias) {
    const existing = await Entry.findOne({
      alias: entryData.alias,
      isInvalid: { $ne: true }
    });
    if (existing) {
      throw new BusinessError('alias already exists', 409, 'ALREADY_EXISTS');
    }
  }
  // ...
}

async update(id: string, entryData: Partial<IEntry>): Promise<IEntry | null> {
  const existing = await Entry.findOne({ _id: id, isInvalid: { $ne: true } });
  if (!existing) {
    return null; // Let router handle 404
  }
  // ...
}
```

### ResourceService

```typescript
async download(id: string, range?: { start: number; end: number }): Promise<DownloadResult> {
  const resource = await Resource.findOne(...);
  
  if (!resource) {
    throw new DownloadError('Resource not found', 404, 'NOT_FOUND');
  }

  const block = resource.block as IBlock;
  if (!block || block.isInvalid) {
    throw new DownloadError('Block not found or invalid', 404, 'BLOCK_NOT_FOUND');
  }

  try {
    await fs.access(filePath);
  } catch {
    // Log missing file issue
    await logService.logIssue({...});
    throw new DownloadError('File not found', 404, 'FILE_MISSING');
  }

  // Range validation
  if (range) {
    if (range.start >= block.size || range.end >= block.size) {
      throw new DownloadError('Range not satisfiable', 416, 'RANGE_INVALID');
    }
  }
  // ...
}
```

### UploadService

```typescript
async processUpload(alias: string, ...): Promise<IResource> {
  const entry = await Entry.findOne({ alias: alias, isInvalid: { $ne: true } });
  
  if (!entry) {
    throw new UploadBusinessError('Entry not found', 404);
  }

  if (entry.uploadConfig?.readOnly) {
    throw new UploadBusinessError('Entry is read-only', 403);
  }

  if (uploadConfig?.maxFileSize && size > uploadConfig.maxFileSize) {
    throw new UploadBusinessError('File too large', 413);
  }

  const isAllowed = uploadConfig.allowedMimeTypes?.some(pattern => ...);
  if (!isAllowed) {
    throw new UploadBusinessError('File type not allowed', 415);
  }
}
```

---

## Router Error Handling

### Global Error Middleware

```typescript
// src/app.ts
app.onError((err, c) => {
  console.error('Error:', err);

  // Handle known error types
  if (err instanceof BusinessError) {
    return c.json({ error: err.message }, err.statusCode);
  }

  if (err instanceof UploadBusinessError) {
    return c.json({ error: err.message }, err.statusCode);
  }

  if (err instanceof DownloadError) {
    return c.json({ error: err.message, code: err.code }, err.statusCode);
  }

  // Handle Zod validation errors
  if (err instanceof z.ZodError) {
    return c.json({
      error: 'Validation error',
      details: err.errors.map(e => ({
        field: e.path.join('.'),
        message: e.message
      }))
    }, 400);
  }

  // Default to 500
  return c.json({ error: 'Internal server error' }, 500);
});
```

### Route-Level Error Handling

```typescript
// Example: resourceRouter.ts
router.get('/:id/download', async (c) => {
  try {
    const id = c.req.param('id');
    const range = c.req.parsedQuery('range');
    
    const result = await resourceService.download(id, parsedRange);
    
    // Return stream response
    return c.stream(async (stream) => {
      // ... decrypt and pipe to response
    });
  } catch (err) {
    if (err instanceof DownloadError) {
      return c.json({ error: err.message, code: err.code }, err.statusCode);
    }
    throw err; // Let global handler catch it
  }
});
```

---

## Validation Errors (Zod)

### Request Validation

```typescript
// routes/entryRouter.ts
const CreateEntrySchema = z.object({
  name: z.string().min(1).max(100),
  alias: z.string().max(50).optional(),
  isDefault: z.boolean().optional(),
  description: z.string().max(500).optional(),
  uploadConfig: z.object({
    maxFileSize: z.number().positive().optional(),
    allowedMimeTypes: z.array(z.string()).optional(),
    readOnly: z.boolean().optional()
  }).optional()
});

// Route uses middleware to validate before calling service
router.post('/', validateZod(CreateEntrySchema), async (c) => {
  const data = c.req.valid('json');
  const entry = await entryService.create(data);
  return c.json(entry, 201);
});
```

### Error Response from Zod

```json
{
  "error": "Validation error",
  "details": [
    { "field": "name", "message": "String must contain at least 1 character(s)" },
    { "field": "uploadConfig.maxFileSize", "message": "Number must be greater than 0" }
  ]
}
```

---

## Logging Errors

### Error Logging to LogService

```typescript
// Log runtime errors to LogService
async function handleDownloadError(err: Error, resourceId: string): Promise<void> {
  if (err instanceof DownloadError) {
    // Don't log expected errors
    return;
  }

  await logService.logIssue({
    level: LogLevel.ERROR,
    category: LogCategory.RUNTIME_ERROR,
    resourceIds: [resourceId],
    details: {
      error: err.message,
      stack: err.stack
    },
    suggestedAction: 'Investigate server logs',
    recoverable: true,
    dataLossRisk: DataLossRisk.NONE,
    context: {
      detectedBy: 'resourceService',
      detectedAt: Date.now(),
      stackTrace: err.stack
    }
  });
}
```

---

## Client Error Handling

### JavaScript SDK Example

```typescript
class ReblockClient {
  async upload(alias: string, file: File): Promise<Resource> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`/upload/${alias}`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const error = await response.json();
      
      switch (response.status) {
        case 413:
          throw new Error(`File too large: ${error.error}`);
        case 415:
          throw new Error(`Invalid file type: ${error.error}`);
        case 403:
          throw new Error(`Entry is read-only: ${error.error}`);
        default:
          throw new Error(`Upload failed: ${error.error}`);
      }
    }

    return response.json();
  }
}
```

---

## Implementation Checklist

When implementing error handling, ensure:

- [ ] Custom error classes extend Error with proper name
- [ ] HTTP status codes are appropriate for error type
- [ ] Error codes are included for programmatic handling
- [ ] Global error handler catches unhandled errors
- [ ] Zod validation errors are properly formatted
- [ ] Error messages are user-friendly
- [ ] Stack traces are logged (not exposed to client)
- [ ] Critical errors are logged to LogService
- [ ] 404 returns null from service (router converts to response)
