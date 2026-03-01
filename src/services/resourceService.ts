import fs from 'fs/promises';
import path from 'path';
import { Resource, Block, Entry } from '../models';
import type { IResource, IBlock } from '../models';
import type { PaginatedResult } from './types';
import { env } from '../config/env';
import { generateStorageName, generateIV } from '../utils/crypto';
import { logService } from './logService';
import { LogLevel, LogCategory, DataLossRisk } from '../models/logEntry';

// MongoDB filter type - allows flexible query objects
type MongoFilter = Record<string, unknown>;

export interface DownloadResult {
  filePath: string;
  mime: string;
  filename: string;
  size: number;        // Size of content to return (may be partial)
  totalSize: number;   // Total file size
  range?: {            // Range info if partial content
    start: number;
    end: number;
  };
  iv: Buffer;          // 16-byte IV for decryption (from block._id)
}

export class DownloadError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'DownloadError';
  }
}

// Extended resource type with sha256 from populated block
export type IResourceWithSha256 = IResource & { sha256?: string; size?: number };

export interface IResourceService {
  create(resourceData: Partial<IResource>): Promise<IResource>;
  update(id: string, resourceData: Partial<IResource>): Promise<IResource | null>;
  getById(id: string): Promise<IResourceWithSha256 | null>;
  list(filter?: MongoFilter, limit?: number, offset?: number): Promise<PaginatedResult<IResourceWithSha256>>;
  delete(id: string): Promise<IResource | null>;
  download(id: string, range?: { start: number; end: number }): Promise<DownloadResult>;
}

export class ResourceService implements IResourceService {
  async create(resourceData: Partial<IResource>): Promise<IResource> {
    // Service layer injects timestamps (per timestamp-soft-delete rule)
    const resource = new Resource({
      ...resourceData,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastAccessedAt: Date.now()
    });
    
    const savedResource = await resource.save();
    return savedResource;
  }

  async update(id: string, resourceData: Partial<IResource>): Promise<IResource | null> {
    // Check if resource exists and is not soft-deleted
    const existingResource = await Resource.findOne({ _id: id, isInvalid: { $ne: true } });
    if (!existingResource) {
      return null;
    }

    // Remove server-controlled fields from input
    const safeData = { ...resourceData };
    delete (safeData as Record<string, unknown>).createdAt;
    delete (safeData as Record<string, unknown>).updatedAt;
    delete (safeData as Record<string, unknown>).invalidatedAt;

    const updatedResource = await Resource.findByIdAndUpdate(
      id,
      {
        ...safeData,
        updatedAt: Date.now(),
      },
      { new: true }
    );

    return updatedResource;
  }

  async getById(id: string): Promise<(IResource & { sha256?: string }) | null> {
    const resource = await Resource.findOne({ _id: id, isInvalid: { $ne: true } })
      .populate('block', 'sha256')
      .exec();
    
    if (!resource) {
      return null;
    }

    // Add sha256 from populated block and keep block as ID string
    const resourceObj = resource.toObject() as IResourceWithSha256;
    if (resource.block && typeof resource.block === 'object' && 'sha256' in resource.block) {
      resourceObj.sha256 = (resource.block as IBlock).sha256;
      // Restore block to ID string
      (resourceObj as unknown as { block: string }).block = (resource.block as IBlock)._id.toString();
    }
    
    return resourceObj;
  }

  async list(filter: MongoFilter = {}, limit?: number, offset?: number): Promise<PaginatedResult<IResourceWithSha256>> {
    const { entryAlias, ...otherFilters } = filter;
    
    // Build MongoDB filter
    const mongoFilter: MongoFilter = { ...otherFilters };
    
    // If entryAlias is provided, look up the entry and filter by entry ID
    if (entryAlias && typeof entryAlias === 'string') {
      const entry = await Entry.findOne({ alias: entryAlias, isInvalid: { $ne: true } });
      if (entry) {
        mongoFilter.entry = entry._id;
      } else {
        // Entry not found - return empty result
        return { items: [], total: 0, limit, offset };
      }
    }
    
    const safeFilter = { ...mongoFilter, isInvalid: { $ne: true } };

    // Check if pagination is requested
    const isPaginated = limit !== undefined || offset !== undefined;

    if (isPaginated) {
      // Apply stable ordering for pagination (createdAt DESC, _id DESC as tie-breaker)
      const [items, total] = await Promise.all([
        Resource.find(safeFilter)
          .sort({ createdAt: -1, _id: -1 })
          .skip(offset || 0)
          .limit(limit || 50)
          .populate('block', 'sha256 size')
          .exec(),
        Resource.countDocuments(safeFilter)
      ]);

      // Add sha256 and size from populated block and keep block as ID string
      const itemsWithSha256 = items.map(item => {
        const itemObj = item.toObject() as IResourceWithSha256;
        if (item.block && typeof item.block === 'object' && 'sha256' in item.block) {
          itemObj.sha256 = (item.block as IBlock).sha256;
          itemObj.size = (item.block as IBlock).size;
          // Restore block to ID string
          (itemObj as unknown as { block: string }).block = (item.block as IBlock)._id.toString();
        }
        return itemObj;
      });

      return {
        items: itemsWithSha256,
        total,
        limit,
        offset
      };
    }

    // Non-paginated: return all items with total count
    const items = await Resource.find(safeFilter)
      .sort({ createdAt: -1, _id: -1 })
      .populate('block', 'sha256 size')
      .exec();
    
    // Add sha256 and size from populated block and keep block as ID string
    const itemsWithSha256 = items.map(item => {
      const itemObj = item.toObject() as IResourceWithSha256;
      if (item.block && typeof item.block === 'object' && 'sha256' in item.block) {
        itemObj.sha256 = (item.block as IBlock).sha256;
        itemObj.size = (item.block as IBlock).size;
        // Restore block to ID string
        (itemObj as unknown as { block: string }).block = (item.block as IBlock)._id.toString();
      }
      return itemObj;
    });
    
    return {
      items: itemsWithSha256,
      total: itemsWithSha256.length
    };
  }
  
  async delete(id: string): Promise<IResource | null> {
    // Check if resource exists and is not soft-deleted
    const existingResource = await Resource.findOne({ _id: id, isInvalid: { $ne: true } });
    if (!existingResource) {
      return null;
    }

    // Decrement block linkCount
    const blockId = existingResource.block;
    if (blockId) {
      const block = await Block.findOne({ _id: blockId, isInvalid: { $ne: true } });
      if (block) {
        block.linkCount = Math.max(0, (block.linkCount || 0) - 1);
        block.updatedAt = Date.now();
        await block.save();
      }
    }

    return Resource.findByIdAndUpdate(
      id,
      {
        isInvalid: true,
        invalidatedAt: Date.now(),
        updatedAt: Date.now(),
      },
      { new: true }
    );
  }

  private getStoragePath(sha256: string): string {
    const storageName = generateStorageName(sha256);
    const prefix1 = storageName.substring(0, 2);
    const secondChar = storageName.substring(2, 3);
    const relativePath = `${prefix1}/${secondChar}${storageName}`;
    return path.join(env.STORAGE_BLOCK_DIR, relativePath);
  }

  async download(id: string, range?: { start: number; end: number }): Promise<DownloadResult> {
    const resource = await Resource.findOne({
      _id: id,
      isInvalid: { $ne: true }
    }).populate('block');

    if (!resource) {
      throw new DownloadError('Resource not found', 404);
    }

    const block = resource.block as IBlock;

    // Data consistency check - block linkCount validation
    if (block.linkCount === 0) {
      throw new DownloadError(
        `Data inconsistency: Block ${block._id} has linkCount=0 but resource ${id} is valid`,
        500,
        'DATA_INCONSISTENCY'
      );
    }

    // Construct file path using storage name (HMAC of sha256)
    const filePath = this.getStoragePath(block.sha256);

    // Get actual file size and verify against block.size
    let actualSize: number;
    try {
      const stats = await fs.stat(filePath);
      actualSize = stats.size;
    } catch {
      throw new DownloadError(
        `Block file not found: ${filePath}`,
        500,
        'FILE_MISSING'
      );
    }

    // Verify file size matches block.size
    if (actualSize !== block.size) {
      await logService.logIssue({
        level: LogLevel.ERROR,
        category: LogCategory.FILE_SIZE_MISMATCH,
        blockId: block._id.toString(),
        details: {
          sha256: block.sha256,
          dbSize: block.size,
          actualSize,
          filePath,
        },
        suggestedAction: 'Verify block integrity and consider re-uploading content',
        recoverable: false,
        dataLossRisk: DataLossRisk.HIGH,
        context: {
          detectedBy: 'resourceService',
          detectedAt: Date.now(),
          environment: env.NODE_ENV as 'development' | 'production' | 'test',
        },
      });
      throw new DownloadError(
        `Block size mismatch for ${block._id}`,
        500,
        'SIZE_MISMATCH'
      );
    }

    // Validate range if provided
    if (range) {
      // Range validation: start must be < end, end must be < totalSize
      if (range.start < 0 || range.end < 0 || range.start > range.end || range.start >= actualSize) {
        throw new DownloadError('Invalid range', 416, 'INVALID_RANGE');
      }
      // If end exceeds file size, return 416 (not silently adjust)
      if (range.end >= actualSize) {
        throw new DownloadError('Invalid range', 416, 'INVALID_RANGE');
      }
    }

    // Generate IV from block._id (12 bytes → 16 bytes with padding)
    const objectIdBuffer = (block._id as any).id || Buffer.from(block._id.toString(), 'hex');
    const iv = generateIV(objectIdBuffer);

    // Update lastAccessedAt (async, non-blocking)
    Resource.findByIdAndUpdate(id, {
      lastAccessedAt: Date.now()
    }).catch(async (error) => {
      await logService.logIssue({
        level: LogLevel.WARNING,
        category: LogCategory.RUNTIME_ERROR,
        resourceIds: [id],
        details: {
          operation: 'updateLastAccessedAt',
          error: error.message,
        },
        suggestedAction: 'Investigate database write failure',
        recoverable: true,
        dataLossRisk: DataLossRisk.LOW,
        context: {
          detectedBy: 'resourceService',
          detectedAt: Date.now(),
          environment: env.NODE_ENV as 'development' | 'production' | 'test',
          stackTrace: error.stack,
        },
      });
    });

    const result: DownloadResult = {
      filePath,
      mime: resource.mime || 'application/octet-stream',
      filename: resource.name || 'download',
      size: range ? range.end - range.start + 1 : actualSize,
      totalSize: actualSize,
      iv,
    };

    if (range) {
      result.range = {
        start: range.start,
        end: range.end,
      };
    }

    return result;
  }
}

export const resourceService = new ResourceService();
