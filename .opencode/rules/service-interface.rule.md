# Service Interface Rule

This document defines the complete interface for all services in the Reblock service.

---

## Common Types

### PaginatedResult

```typescript
interface PaginatedResult<T> {
  items: T[];
  total: number;
  limit?: number;
  offset?: number;
}
```

### MongoFilter

```typescript
type MongoFilter = Record<string, unknown>;
```

---

## BlockService

### Interface

```typescript
interface IBlockService {
  create(blockData: Partial<IBlock>): Promise<IBlock>;
  update(id: string, blockData: Partial<IBlock>): Promise<IBlock | null>;
  getById(id: string): Promise<IBlock | null>;
  list(filter?: MongoFilter, limit?: number, offset?: number): Promise<PaginatedResult<IBlock>>;
  delete(id: string): Promise<IBlock | null>;
}
```

### Implementation

```typescript
class BlockService implements IBlockService {
  // CREATE
  async create(blockData: Partial<IBlock>): Promise<IBlock> {
    const dataWithTimestamps = {
      ...blockData,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const block = new Block(dataWithTimestamps);
    return block.save();
  }

  // UPDATE
  async update(id: string, blockData: Partial<IBlock>): Promise<IBlock | null> {
    // Remove server-controlled fields from input
    const safeData = { ...blockData };
    delete safeData.createdAt;
    delete safeData.updatedAt;
    delete safeData.invalidatedAt;
    
    return Block.findByIdAndUpdate(
      id,
      { ...safeData, updatedAt: Date.now() },
      { new: true }
    );
  }

  // GET BY ID
  async getById(id: string): Promise<IBlock | null> {
    return Block.findOne({ _id: id, isInvalid: { $ne: true } });
  }

  // LIST (with pagination)
  async list(filter: MongoFilter = {}, limit?: number, offset?: number): Promise<PaginatedResult<IBlock>> {
    const safeFilter = { ...filter, isInvalid: { $ne: true } };
    
    const isPaginated = limit !== undefined || offset !== undefined;
    
    if (isPaginated) {
      const [items, total] = await Promise.all([
        Block.find(safeFilter)
          .sort({ createdAt: -1, _id: -1 })
          .skip(offset || 0)
          .limit(limit || 50)
          .exec(),
        Block.countDocuments(safeFilter),
      ]);
      return { items, total, limit, offset };
    }
    
    const items = await Block.find(safeFilter).sort({ createdAt: -1, _id: -1 }).exec();
    return { items, total: items.length };
  }

  // DELETE (soft delete)
  async delete(id: string): Promise<IBlock | null> {
    return Block.findByIdAndUpdate(
      id,
      { isInvalid: true, invalidatedAt: Date.now(), updatedAt: Date.now() },
      { new: true }
    );
  }
}
```

### Key Behaviors

- All queries filter out soft-deleted blocks by default
- Timestamps are auto-injected on create/update
- Server-controlled fields are stripped from user input
- Pagination uses stable sorting (`createdAt DESC, _id DESC`)

---

## EntryService

### Interface

```typescript
interface IEntryService {
  create(entryData: Partial<IEntry>): Promise<IEntry>;
  update(id: string, entryData: Partial<IEntry>): Promise<IEntry | null>;
  getById(id: string): Promise<IEntry | null>;
  getDefault(): Promise<IEntry | null>;
  list(filter?: MongoFilter, limit?: number, offset?: number): Promise<PaginatedResult<IEntry>>;
  delete(id: string): Promise<IEntry | null>;
}
```

### Implementation Highlights

```typescript
class EntryService implements IEntryService {
  async create(entryData: Partial<IEntry>): Promise<IEntry> {
    // Business uniqueness check for alias
    if (entryData.alias) {
      const existing = await Entry.findOne({
        alias: entryData.alias,
        isInvalid: { $ne: true }
      });
      if (existing) {
        throw new BusinessError('alias already exists', 409);
      }
    }

    // If setting as default, unset any existing default first
    if (entryData.isDefault === true) {
      await Entry.updateMany(
        { isDefault: true, isInvalid: false },
        { isDefault: false, updatedAt: Date.now() }
      );
    }

    const dataWithTimestamps = {
      ...entryData,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const entry = new Entry(dataWithTimestamps);
    return entry.save();
  }

  async getDefault(): Promise<IEntry | null> {
    return Entry.findOne({ isDefault: true, isInvalid: { $ne: true } });
  }

  async update(id: string, entryData: Partial<IEntry>): Promise<IEntry | null> {
    const existingEntry = await Entry.findOne({ _id: id, isInvalid: { $ne: true } });
    if (!existingEntry) return null;

    // Handle alias uniqueness
    if (entryData.alias && entryData.alias !== existingEntry.alias) {
      const duplicate = await Entry.findOne({
        alias: entryData.alias,
        isInvalid: { $ne: true },
        _id: { $ne: id }
      });
      if (duplicate) {
        throw new BusinessError('alias already exists', 409);
      }
    }

    // Handle default flag change
    if (entryData.isDefault === true && !existingEntry.isDefault) {
      await Entry.updateMany(
        { isDefault: true, isInvalid: false, _id: { $ne: id } },
        { isDefault: false, updatedAt: Date.now() }
      );
    }

    // Remove server-controlled fields
    const safeData = { ...entryData };
    delete safeData.createdAt;
    delete safeData.updatedAt;
    delete safeData.invalidatedAt;
    delete safeData.isInvalid;

    return Entry.findByIdAndUpdate(
      id,
      { ...safeData, updatedAt: Date.now() },
      { new: true }
    );
  }
}
```

### BusinessError

```typescript
class BusinessError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
    this.name = 'BusinessError';
  }
}
```

---

## ResourceService

### Interface

```typescript
interface IResourceService {
  create(resourceData: Partial<IResource>): Promise<IResource>;
  update(id: string, resourceData: Partial<IResource>): Promise<IResource | null>;
  getById(id: string): Promise<IResourceWithSha256 | null>;
  list(filter?: MongoFilter, limit?: number, offset?: number): Promise<PaginatedResult<IResourceWithSha256>>;
  delete(id: string): Promise<IResource | null>;
  download(id: string, range?: { start: number; end: number }): Promise<DownloadResult>;
}
```

### Extended Types

```typescript
interface IResourceWithSha256 extends IResource {
  sha256?: string;
  size?: number;
}

interface DownloadResult {
  filePath: string;
  mime: string;
  filename: string;
  size: number;
  totalSize: number;
  range?: {
    start: number;
    end: number;
  };
  iv: Buffer;
}

class DownloadError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'DownloadError';
  }
}
```

### Implementation Highlights

```typescript
class ResourceService implements IResourceService {
  async create(resourceData: Partial<IResource>): Promise<IResource> {
    const resource = new Resource({
      ...resourceData,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastAccessedAt: Date.now()
    });
    return resource.save();
  }

  async getById(id: string): Promise<IResourceWithSha256 | null> {
    const resource = await Resource.findOne({ _id: id, isInvalid: { $ne: true } })
      .populate('block', 'sha256')
      .exec();
    
    if (!resource) return null;

    const resourceObj = resource.toObject() as IResourceWithSha256;
    if (resource.block && typeof resource.block === 'object' && 'sha256' in resource.block) {
      resourceObj.sha256 = resource.block.sha256;
    }
    return resourceObj;
  }

  async delete(id: string): Promise<IResource | null> {
    const resource = await Resource.findOne({ _id: id, isInvalid: { $ne: true } });
    if (!resource) return null;

    // Decrement block linkCount
    await Block.findByIdAndUpdate(resource.block, {
      $inc: { linkCount: -1 },
      updatedAt: Date.now()
    });

    // Soft delete resource
    return Resource.findByIdAndUpdate(
      id,
      { isInvalid: true, invalidatedAt: Date.now(), updatedAt: Date.now() },
      { new: true }
    );
  }

  async download(id: string, range?: { start: number; end: number }): Promise<DownloadResult> {
    // Step 1: Find resource and block
    const resource = await Resource.findOne({ _id: id, isInvalid: { $ne: true } })
      .populate('block')
      .exec();
    
    if (!resource) {
      throw new DownloadError('Resource not found', 404, 'NOT_FOUND');
    }

    const block = resource.block as IBlock;
    if (!block || block.isInvalid) {
      throw new DownloadError('Block not found or invalid', 404, 'BLOCK_NOT_FOUND');
    }

    // Step 2: Generate storage path (HMAC-SHA256) and IV
    // IMPORTANT: See storage-path-calculation.md for path algorithm
    const storageName = generateStorageName(block.sha256);
    const filePath = getStoragePath(storageName);
    const iv = generateIV(block._id);

    // Step 3: Check file exists
    try {
      await fs.access(filePath);
    } catch {
      // Log missing file issue
      await logService.logIssue({...});
      throw new DownloadError('File not found', 404, 'FILE_MISSING');
    }

    // Step 4: Handle Range request
    let rangeInfo: { start: number; end: number; size: number };
    if (range) {
      // Validate range
      if (range.start >= block.size || range.end >= block.size) {
        throw new DownloadError('Range not satisfiable', 416, 'RANGE_INVALID');
      }
      rangeInfo = {
        start: range.start,
        end: Math.min(range.end, block.size - 1),
        size: Math.min(range.end - range.start + 1, block.size)
      };
    } else {
      rangeInfo = { start: 0, end: block.size - 1, size: block.size };
    }

    // Step 5: Update lastAccessedAt
    await Resource.findByIdAndUpdate(id, { lastAccessedAt: Date.now() });

    return {
      filePath,
      mime: resource.mime || 'application/octet-stream',
      filename: resource.name || 'download',
      size: rangeInfo.size,
      totalSize: block.size,
      range: range ? { start: rangeInfo.start, end: rangeInfo.end } : undefined,
      iv
    };
  }
}
```

---

## UploadService

### Interface

```typescript
interface IUploadService {
  processUpload(alias: string, tempFilePath: string, name?: string, mime?: string): Promise<IResource>;
}
```

### BusinessError

```typescript
class UploadBusinessError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
    this.name = 'UploadBusinessError';
  }
}
```

### Implementation Flow

```typescript
class UploadService implements IUploadService {
  private readonly tempDir = env.STORAGE_TEMP_DIR;
  private readonly blocksDir = env.STORAGE_BLOCK_DIR;

  async processUpload(alias: string, tempFilePath: string, name?: string, mime?: string): Promise<IResource> {
    // Step 1: Validate Entry and check upload config
    const entry = await this.validateEntryWithConfig(alias);

    // Step 2: Compute SHA256 of temp file
    const sha256 = await this.computeSHA256(tempFilePath);

    // Step 3: Get file size
    const stats = await fs.stat(tempFilePath);
    const size = stats.size;

    // Step 4: Validate file size against upload config
    this.validateFileSize(size, entry.uploadConfig);

    // Step 5: Detect MIME type using file-type library
    const detectedMime = await this.detectMimeType(tempFilePath);

    // Step 6: Validate MIME type against upload config
    this.validateMimeType(detectedMime, entry.uploadConfig);

    // Step 7: Block Deduplication
    const block = await this.handleBlockDeduplication(sha256, size, tempFilePath);

    // Step 8: Create Resource
    const resource = await this.createResource(entry, block, name, detectedMime);

    return resource;
  }

  private async validateEntryWithConfig(alias: string): Promise<IEntry> {
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

  private validateFileSize(size: number, uploadConfig?: IUploadConfig): void {
    if (uploadConfig?.maxFileSize && size > uploadConfig.maxFileSize) {
      throw new UploadBusinessError('File too large', 413);
    }
  }

  private validateMimeType(mime: string, uploadConfig?: IUploadConfig): void {
    if (!uploadConfig?.allowedMimeTypes?.length) return;

    const isAllowed = uploadConfig.allowedMimeTypes.some(pattern => {
      if (pattern.endsWith('/*')) {
        const prefix = pattern.slice(0, -1);
        return mime.startsWith(prefix);
      }
      return mime === pattern;
    });

    if (!isAllowed) {
      throw new UploadBusinessError('File type not allowed', 415);
    }
  }

  private async handleBlockDeduplication(sha256: string, size: number, tempFilePath: string): Promise<IBlock> {
    // Check if block with same SHA256 exists
    const existingBlock = await Block.findOne({ sha256, isInvalid: false });

    if (existingBlock) {
      // Increment linkCount and reuse existing block
      existingBlock.linkCount += 1;
      existingBlock.updatedAt = Date.now();
      await existingBlock.save();
      return existingBlock;
    }

    // Create new block
    const iv = generateIV(new Types.ObjectId());
    // HMAC-SHA256 based storage path (see storage-path-calculation.md)
    const storageName = generateStorageName(sha256);
    const blockPath = getStoragePath(storageName);

    // Encrypt and save file
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

  private async createResource(entry: IEntry, block: IBlock, name?: string, mime?: string): Promise<IResource> {
    const resource = new Resource({
      block: block._id,
      entry: entry._id,
      name: name || '',
      mime: mime || 'application/octet-stream',
      description: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastAccessedAt: Date.now()
    });
    return resource.save();
  }
}
```

---

## LogService

### Interface

```typescript
interface ILogService {
  // Log a detected issue
  logIssue(params: LogIssueParams): Promise<ILogEntry>;

  // Log a cleanup action
  logCleanupAction(params: LogCleanupActionParams): Promise<ILogEntry>;

  // Check for duplicate issues
  checkDuplicate(category: LogCategory, blockId: string, sinceHours?: number): Promise<boolean>;

  // Query methods
  findByBlockId(blockId: string, limit?: number): Promise<ILogEntry[]>;
  findOpenIssues(category?: LogCategory): Promise<ILogEntry[]>;
  findRecent(days: number, filter?: LogFilter): Promise<ILogEntry[]>;

  // Status management
  markResolved(logId: string, resolution: string, resolvedBy?: string): Promise<void>;
  markAcknowledged(logId: string, note?: string): Promise<void>;

  // Reporting
  generateSummary(): Promise<LogSummary>;
}
```

### Parameter Types

```typescript
interface LogIssueParams {
  level: LogLevel;
  category: LogCategory;
  blockId?: string | Types.ObjectId;
  resourceIds?: (string | Types.ObjectId)[];
  entryIds?: (string | Types.ObjectId)[];
  details: Record<string, any>;
  suggestedAction: string;
  recoverable: boolean;
  dataLossRisk?: DataLossRisk;
  recoverySteps?: string[];
  context?: Partial<ILogContext>;
}

interface LogCleanupActionParams {
  action: 'soft_delete' | 'fix_linkcount' | 'merge_blocks';
  targetBlockId: string;
  previousState: Record<string, any>;
  result?: Record<string, any>;
  success: boolean;
  error?: string;
  context?: Partial<ILogContext>;
}

interface LogFilter {
  level?: LogLevel;
  status?: IssueStatus;
  category?: LogCategory;
  detectedBy?: string;
}

interface LogSummary {
  total: number;
  byCategory: Record<LogCategory, number>;
  byLevel: Record<LogLevel, number>;
  byStatus: Record<IssueStatus, number>;
  recentCritical: ILogEntry[];
}
```

### Implementation Highlights

```typescript
class LogService implements ILogService {
  private readonly LOG_DIR: string;
  private readonly ISSUES_DIR: string;
  private readonly ACTIONS_DIR: string;
  private readonly ARCHIVE_DIR: string;

  async logIssue(params: LogIssueParams): Promise<ILogEntry> {
    const now = Date.now();
    const logEntry = new LogEntry({
      timestamp: now,
      level: params.level,
      category: params.category,
      blockId: params.blockId ? new Types.ObjectId(params.blockId as string) : undefined,
      resourceIds: params.resourceIds?.map(id => new Types.ObjectId(id as string)),
      entryIds: params.entryIds?.map(id => new Types.ObjectId(id as string)),
      details: params.details,
      context: {
        detectedBy: params.context?.detectedBy || 'system',
        detectedAt: params.context?.detectedAt || now,
        environment: env.NODE_ENV as 'development' | 'production' | 'test',
        ...params.context
      },
      suggestedAction: params.suggestedAction,
      recoverable: params.recoverable,
      dataLossRisk: params.dataLossRisk || DataLossRisk.NONE,
      recoverySteps: params.recoverySteps,
      status: IssueStatus.OPEN,
      createdAt: now,
      expiresAt: now + (env.LOG_TTL_DAYS * 24 * 60 * 60 * 1000)
    });

    const saved = await logEntry.save();

    // Also write to JSON Lines file for AI analysis
    await this.writeToJsonLine(saved);

    return saved;
  }

  async checkDuplicate(category: LogCategory, blockId: string, sinceHours: number = 24): Promise<boolean> {
    const since = Date.now() - (sinceHours * 60 * 60 * 1000);
    const existing = await LogEntry.findOne({
      category,
      blockId: new Types.ObjectId(blockId),
      timestamp: { $gte: since },
      status: { $ne: IssueStatus.RESOLVED }
    });
    return !!existing;
  }

  async findRecent(days: number, filter?: LogFilter): Promise<ILogEntry[]> {
    const since = Date.now() - (days * 24 * 60 * 60 * 1000);
    const query: Record<string, any> = { timestamp: { $gte: since } };
    
    if (filter?.level) query.level = filter.level;
    if (filter?.status) query.status = filter.status;
    if (filter?.category) query.category = filter.category;
    if (filter?.detectedBy) query['context.detectedBy'] = filter.detectedBy;

    return LogEntry.find(query)
      .sort({ timestamp: -1 })
      .limit(1000)
      .exec();
  }

  async markResolved(logId: string, resolution: string, resolvedBy?: string): Promise<void> {
    await LogEntry.findByIdAndUpdate(logId, {
      status: IssueStatus.RESOLVED,
      resolvedAt: Date.now(),
      resolution,
      resolvedBy,
      statusHistory: {
        status: IssueStatus.RESOLVED,
        changedAt: Date.now(),
        changedBy: resolvedBy,
        note: resolution
      }
    });
  }

  private async writeToJsonLine(entry: ILogEntry): Promise<void> {
    const date = new Date(entry.timestamp).toISOString().split('T')[0];
    const filePath = join(this.ISSUES_DIR, `${date}.jsonl`);
    
    await mkdir(this.ISSUES_DIR, { recursive: true });
    await appendFile(filePath, JSON.stringify(entry) + '\n');
  }
}
```

---

## Service Singleton Exports

All services are exported as singletons:

```typescript
// src/services/index.ts
export const blockService = new BlockService();
export const entryService = new EntryService();
export const resourceService = new ResourceService();
export const uploadService = new UploadService();
export const logService = new LogService();
```

---

## Implementation Checklist

When implementing services, ensure:

- [ ] All CRUD operations follow the interface signature
- [ ] Timestamps are injected in service layer
- [ ] Soft delete filtering is applied to all queries
- [ ] Server-controlled fields are stripped from user input
- [ ] Pagination uses stable sorting
- [ ] LinkCount is properly maintained in ResourceService
- [ ] Duplicate detection is implemented in LogService
- [ ] Dual storage (MongoDB + JSONL) is implemented in LogService
- [ ] Errors throw appropriate custom error types
