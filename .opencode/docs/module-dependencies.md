# Module Dependencies

This document describes the module dependencies and architecture of the Reblock service.

---

## Architecture Layers

```
┌─────────────────────────────────────────────────────────────┐
│                      Routes Layer                           │
│   (entryRouter, resourceRouter, blockRouter, uploadRouter) │
└─────────────────────────┬───────────────────────────────────┘
                          │ calls
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    Schemas Layer                             │
│        (Zod validation schemas for API contracts)            │
└─────────────────────────┬───────────────────────────────────┘
                          │ validates
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    Services Layer                            │
│     (blockService, entryService, resourceService, etc.)     │
└─────────────────────────┬───────────────────────────────────┘
                          │ CRUD operations
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                     Models Layer                             │
│              (Block, Entry, Resource, LogEntry)             │
└─────────────────────────┬───────────────────────────────────┘
                          │ mongoose
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    MongoDB Database                          │
└─────────────────────────────────────────────────────────────┘
```

---

## File Structure

```
src/
├── app.ts                    # App setup, routes, middleware
├── server.ts                 # Server entry point
├── config/
│   └── env.ts                # Environment configuration
├── middleware/
│   └── audit.ts              # Audit middleware
├── models/
│   ├── index.ts              # Mongoose models (Block, Entry, Resource)
│   └── logEntry.ts           # LogEntry model & types
├── routes/
│   ├── entryRouter.ts        # /entries endpoints
│   ├── resourceRouter.ts     # /resources endpoints
│   ├── blockRouter.ts        # /blocks endpoints
│   ├── uploadRouter.ts       # /upload endpoints
│   └── middlewares/
│       └── validate.ts        # Zod validation middleware
├── services/
│   ├── index.ts              # Service singletons
│   ├── blockService.ts       # Block CRUD
│   ├── entryService.ts       # Entry CRUD
│   ├── resourceService.ts    # Resource CRUD + download
│   ├── uploadService.ts      # Upload processing
│   ├── logService.ts         # Logging service
│   ├── auditService.ts       # Audit logging
│   └── types.ts              # Shared service types
└── utils/
    └── crypto.ts             # Encryption/decryption utilities
```

---

## Dependency Graph

### Routes → Services

```
entryRouter.ts
    └── entryService.ts
            ├── Entry (model)
            └── logService.ts (for errors)

resourceRouter.ts
    └── resourceService.ts
            ├── Resource (model)
            ├── Block (model)
            ├── logService.ts
            └── crypto.ts (utils)

blockRouter.ts
    └── blockService.ts
            └── Block (model)

uploadRouter.ts
    └── uploadService.ts
            ├── Block (model)
            ├── Entry (model)
            ├── Resource (model)
            └── crypto.ts (utils)
```

### Services → Models

```
blockService.ts
    └── Block

entryService.ts
    ├── Entry
    └── logService.ts

resourceService.ts
    ├── Resource
    ├── Block
    ├── logService.ts
    └── crypto.ts

uploadService.ts
    ├── Block
    ├── Entry
    └── Resource

logService.ts
    └── LogEntry
```

---

## Import Relationships

### app.ts

```typescript
import { entryRouter } from './routes/entryRouter';
import { resourceRouter } from './routes/resourceRouter';
import { blockRouter } from './routes/blockRouter';
import { uploadRouter } from './routes/uploadRouter';
import { auditMiddleware } from './middleware/audit';
```

### Routes (example: entryRouter.ts)

```typescript
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { entryService } from '../services';
import { CreateEntrySchema, UpdateEntrySchema } from '../schemas/entrySchema';
```

### Services (example: resourceService.ts)

```typescript
import { Resource, Block, Entry } from '../models';
import type { IResource, IBlock } from '../models';
import type { PaginatedResult } from './types';
import { env } from '../config/env';
import { generateStorageName, generateIV } from '../utils/crypto';
import { logService } from './logService';
import { LogLevel, LogCategory, DataLossRisk } from '../models/logEntry';
```

### Models (index.ts)

```typescript
import mongoose, { Document, Schema, Types } from 'mongoose';

// Block, Entry, Resource schemas defined here
export const Block = mongoose.model<IBlock>('Block', blockSchema);
export const Resource = mongoose.model<IResource>('Resource', resourceSchema);
export const Entry = mongoose.model<IEntry>('Entry', entrySchema);
export { LogEntry } from './logEntry';
```

---

## Service Dependencies

### BlockService

```
Dependencies: None (standalone)
Uses: Block model only
```

### EntryService

```
Dependencies: [logService]
Uses: Entry model
Throws: BusinessError on conflicts
```

### ResourceService

```
Dependencies: [logService, crypto]
Uses: Resource, Block models
Throws: DownloadError on download failures
```

### UploadService

```
Dependencies: [crypto]
Uses: Block, Entry, Resource models
Throws: UploadBusinessError on validation failures
```

### LogService

```
Dependencies: None (standalone)
Uses: LogEntry model, fs/promises for JSONL
```

---

## Utility Dependencies

### crypto.ts

```typescript
// No external dependencies
// Uses: Node.js built-in crypto module
// Exports:
- generateStorageName(sha256: string): string
- generateIV(blockId: ObjectId): Buffer
- createEncryptStream(iv: Buffer): Transform
- createDecryptStream(iv: Buffer): Transform
- createDecryptStreamWithOffset(iv: Buffer, offset: number): Transform
- getStoragePath(storageName: string): string
```

---

## Configuration Dependencies

### env.ts

```typescript
// No external dependencies
// Uses: dotenv
// Exports: env object with all configuration
```

---

## Middleware Dependencies

### audit.ts

```typescript
import { logService } from '../services';
// Uses: logService to record audit events
```

---

## Cross-Cutting Concerns

### Logging

Services log issues to `logService`:

```typescript
// In resourceService.ts
await logService.logIssue({
  level: LogLevel.ERROR,
  category: LogCategory.MISSING_FILE,
  blockId: block._id,
  details: { reason: 'Physical file missing' },
  suggestedAction: 'Restore from backup or re-upload',
  recoverable: true,
  dataLossRisk: DataLossRisk.HIGH,
  context: { detectedBy: 'resourceService' }
});
```

### Encryption

Resource download uses crypto utilities:

```typescript
// In resourceRouter.ts
import { createDecryptStream, createDecryptStreamWithOffset } from '../utils/crypto';

const decryptStream = range?.start 
  ? createDecryptStreamWithOffset(iv, range.start)
  : createDecryptStream(iv);
```

---

## Dependency Injection

All services are instantiated as singletons:

```typescript
// src/services/index.ts
import { BlockService } from './blockService';
import { EntryService } from './entryService';
import { ResourceService } from './resourceService';
import { UploadService } from './uploadService';
import { LogService } from './logService';
import { AuditService } from './auditService';

export const blockService = new BlockService();
export const entryService = new EntryService();
export const resourceService = new ResourceService();
export const uploadService = new UploadService();
export const logService = new LogService();
export const auditService = new AuditService();
```

---

## Testing Dependencies

### Unit Test Mocks

```typescript
// tests/unit/services/resourceService.test.ts
vi.mock('../../../src/models', () => ({
  Resource: Object.assign(vi.fn(), {...}),
  Block: { findOne: vi.fn() },
  Entry: { findOne: vi.fn() }
}));

vi.mock('../../../src/config/env', () => ({
  env: { STORAGE_BLOCK_DIR: '/storage/blocks', ... }
}));

vi.mock('../../../src/services/logService', () => ({
  logService: { logIssue: vi.fn() }
}));
```

---

## Implementation Checklist

When implementing modules, ensure:

- [ ] Routes only call services (not models directly)
- [ ] Services handle business logic, timestamps, soft delete
- [ ] Models are pure Mongoose schemas
- [ ] Zod schemas define API contracts
- [ ] Services use singleton pattern (exported from index.ts)
- [ ] Crypto utilities are stateless functions
- [ ] Configuration is loaded from env.ts
- [ ] Tests mock external dependencies
