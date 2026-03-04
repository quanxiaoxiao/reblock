import fs from 'fs/promises';
import path from 'path';
import mongoose from 'mongoose';
import { Resource, Block, Entry, ResourceHistory } from '../models';
import type { IResource, IBlock, IResourceHistory } from '../models';
import type { PaginatedResult } from './types';
import { env } from '../config/env';
import { generateStorageName, generateIV } from '../utils/crypto';
import { validatePagination } from '../utils/pagination';
import { logService } from './logService';
import { LogLevel, LogCategory, DataLossRisk } from '../models/logEntry';
import { canUseTransactions, isTransactionUnsupportedError, markTransactionsUnsupported } from '../utils/transaction';

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

export interface ResourceBlockUpdateParams {
  newBlockId: string;
  changedBy?: string;
  reason?: string;
  requestId?: string;
  expectedUpdatedAt?: number;
  action?: 'swap' | 'rollback';
}

export interface ResourceHistoryQueryParams {
  limit?: number;
  offset?: number;
}

export class ResourceMutationError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'ResourceMutationError';
  }
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
  updateBlock(id: string, params: ResourceBlockUpdateParams): Promise<IResource>;
  getById(id: string): Promise<IResourceWithSha256 | null>;
  getHistory(id: string, params?: ResourceHistoryQueryParams): Promise<{ total: number; items: IResourceHistory[] }>;
  rollbackBlock(id: string, historyId: string, changedBy?: string, requestId?: string): Promise<IResource>;
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

  async updateBlock(id: string, params: ResourceBlockUpdateParams): Promise<IResource> {
    if (!mongoose.isValidObjectId(id)) {
      throw new ResourceMutationError('Invalid resource id', 400, 'INVALID_RESOURCE_ID');
    }
    if (!mongoose.isValidObjectId(params.newBlockId)) {
      throw new ResourceMutationError('Invalid block id', 400, 'INVALID_BLOCK_ID');
    }

    const session = await mongoose.startSession();
    let updatedResource: IResource | null = null;
    let auditContext: { fromBlockId?: string; toBlockId?: string; changedAt?: number } = {};

    try {
      const applyMutation = async (sessionArg?: mongoose.ClientSession) => {
        const now = Date.now();
        const findOptions = sessionArg ? { session: sessionArg } : undefined;
        const saveOptions = sessionArg ? { session: sessionArg } : undefined;
        const resource = await Resource.findOne({ _id: id, isInvalid: { $ne: true } }, null, findOptions);
        if (!resource) {
          throw new ResourceMutationError('Resource not found', 404, 'RESOURCE_NOT_FOUND');
        }

        if (
          typeof params.expectedUpdatedAt === 'number' &&
          resource.updatedAt !== params.expectedUpdatedAt
        ) {
          throw new ResourceMutationError('Resource has been updated by another request', 409, 'VERSION_CONFLICT');
        }

        const oldBlockId = resource.block.toString();
        const newBlockId = params.newBlockId;
        auditContext = { fromBlockId: oldBlockId, toBlockId: newBlockId, changedAt: now };

        if (oldBlockId === newBlockId) {
          updatedResource = resource;
          return;
        }

        const oldBlock = await Block.findOne({ _id: oldBlockId, isInvalid: { $ne: true } }, null, findOptions);
        const newBlock = await Block.findOne({ _id: newBlockId, isInvalid: { $ne: true } }, null, findOptions);

        if (!oldBlock) {
          throw new ResourceMutationError('Old block not found', 500, 'OLD_BLOCK_NOT_FOUND');
        }
        if (!newBlock) {
          throw new ResourceMutationError('New block not found', 404, 'NEW_BLOCK_NOT_FOUND');
        }

        resource.block = newBlock._id;
        resource.updatedAt = now;
        await resource.save(saveOptions);

        newBlock.linkCount = (newBlock.linkCount || 0) + 1;
        newBlock.updatedAt = now;
        await newBlock.save(saveOptions);

        oldBlock.linkCount = Math.max(0, (oldBlock.linkCount || 0) - 1);
        oldBlock.updatedAt = now;
        await oldBlock.save(saveOptions);

        const history = new ResourceHistory({
          resourceId: resource._id,
          fromBlockId: oldBlock._id,
          toBlockId: newBlock._id,
          action: params.action || 'swap',
          changedAt: now,
          changedBy: params.changedBy || 'system',
          reason: params.reason || 'manual update',
          requestId: params.requestId,
          rollbackable: true,
        });
        await history.save(saveOptions);

        updatedResource = resource;
      };

      const useTransactions = env.NODE_ENV !== 'test' && await canUseTransactions();
      if (useTransactions) {
        try {
          await session.withTransaction(async () => {
            await applyMutation(session);
          });
        } catch (error) {
          // Fallback for non-replica-set MongoDB (common in local/dev containers).
          if (!isTransactionUnsupportedError(error)) {
            throw error;
          }
          markTransactionsUnsupported();
          await applyMutation();
        }
      } else {
        await applyMutation();
      }
    } catch (error) {
      try {
        await logService.logIssue({
          level: LogLevel.ERROR,
          category: LogCategory.RUNTIME_ERROR,
          resourceIds: [id],
          details: {
            operation: 'updateResourceBlock',
            path: `/resources/${id}/block`,
            method: 'PATCH',
            resourceId: id,
            newBlockId: params.newBlockId,
            requestId: params.requestId,
            changedBy: params.changedBy,
            reason: params.reason,
            error: error instanceof Error ? error.message : String(error),
          },
          suggestedAction: 'Review block switch request and ensure blocks/resources exist',
          recoverable: true,
          dataLossRisk: DataLossRisk.LOW,
          context: {
            detectedBy: 'resourceService',
            detectedAt: Date.now(),
            environment: env.NODE_ENV as 'development' | 'production' | 'test',
            requestId: params.requestId,
            stackTrace: error instanceof Error ? error.stack : undefined,
          },
        });
      } catch {
        // Best effort logging
      }
      throw error;
    } finally {
      await session.endSession();
    }

    if (!updatedResource) {
      throw new ResourceMutationError('Failed to update resource block', 500, 'UPDATE_BLOCK_FAILED');
    }

    try {
      await logService.logAction({
        action: params.action === 'rollback' ? 'resource_block_rollback_applied' : 'resource_block_swap_applied',
        success: true,
        resourceIds: [id],
        blockId: auditContext.toBlockId,
        details: {
          resourceId: id,
          fromBlockId: auditContext.fromBlockId,
          toBlockId: auditContext.toBlockId,
          changedAt: auditContext.changedAt,
          changedBy: params.changedBy || 'system',
          reason: params.reason || 'manual update',
          requestId: params.requestId,
        },
        note: 'Resource block mutation completed',
        actor: params.changedBy || 'system',
        requestId: params.requestId,
      });
    } catch {
      // Best effort audit logging
    }

    return updatedResource;
  }

  async getHistory(id: string, params: ResourceHistoryQueryParams = {}): Promise<{ total: number; items: IResourceHistory[] }> {
    if (!mongoose.isValidObjectId(id)) {
      throw new ResourceMutationError('Invalid resource id', 400, 'INVALID_RESOURCE_ID');
    }

    const { limit, offset } = validatePagination({ limit: params.limit, offset: params.offset });

    const [items, total] = await Promise.all([
      ResourceHistory.find({ resourceId: id })
        .sort({ changedAt: -1, _id: -1 })
        .skip(offset)
        .limit(limit)
        .lean()
        .exec(),
      ResourceHistory.countDocuments({ resourceId: id }),
    ]);

    return { total, items: items as IResourceHistory[] };
  }

  async rollbackBlock(
    id: string,
    historyId: string,
    changedBy: string = 'system',
    requestId?: string
  ): Promise<IResource> {
    if (!mongoose.isValidObjectId(id)) {
      throw new ResourceMutationError('Invalid resource id', 400, 'INVALID_RESOURCE_ID');
    }
    if (!mongoose.isValidObjectId(historyId)) {
      throw new ResourceMutationError('Invalid history id', 400, 'INVALID_HISTORY_ID');
    }

    const target = await ResourceHistory.findOne({ _id: historyId, resourceId: id, rollbackable: true }).lean().exec();
    if (!target) {
      throw new ResourceMutationError('Rollback target not found', 404, 'ROLLBACK_TARGET_NOT_FOUND');
    }

    try {
      await logService.logAction({
        action: 'resource_block_rollback_started',
        success: true,
        resourceIds: [id],
        blockId: target.fromBlockId.toString(),
        details: {
          resourceId: id,
          historyId,
          fromBlockId: target.toBlockId.toString(),
          toBlockId: target.fromBlockId.toString(),
          requestId,
        },
        note: 'Rollback requested',
        actor: changedBy,
        requestId,
      });
    } catch {
      // Best effort audit logging
    }

    const rolledBack = await this.updateBlock(id, {
      newBlockId: target.fromBlockId.toString(),
      changedBy,
      requestId,
      action: 'rollback',
      reason: `rollback from history ${historyId}`,
    });

    try {
      await logService.logAction({
        action: 'resource_block_rollback_completed',
        success: true,
        resourceIds: [id],
        blockId: target.fromBlockId.toString(),
        details: {
          resourceId: id,
          historyId,
          restoredBlockId: target.fromBlockId.toString(),
          replacedBlockId: target.toBlockId.toString(),
          requestId,
        },
        note: 'Rollback completed',
        actor: changedBy,
        requestId,
      });
    } catch {
      // Best effort audit logging
    }

    return rolledBack;
  }

  async getById(id: string): Promise<(IResource & { sha256?: string }) | null> {
    if (!mongoose.isValidObjectId(id)) {
      return null;
    }
    
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
      // Validate pagination parameters
      const { limit: safeLimit, offset: safeOffset } = validatePagination({ limit, offset });

      // Apply stable ordering for pagination (createdAt DESC, _id DESC as tie-breaker)
      const [items, total] = await Promise.all([
        Resource.find(safeFilter)
          .sort({ createdAt: -1, _id: -1 })
          .skip(safeOffset)
          .limit(safeLimit)
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

    const session = await mongoose.startSession();
    let result: IResource | null = null;

    try {
      const applyDelete = async (sessionArg?: mongoose.ClientSession) => {
        const now = Date.now();
        const opts = sessionArg ? { session: sessionArg } : undefined;

        // Decrement block linkCount
        const blockId = existingResource.block;
        if (blockId) {
          const block = await Block.findOne(
            { _id: blockId, isInvalid: { $ne: true } },
            null,
            opts,
          );
          if (block) {
            block.linkCount = Math.max(0, (block.linkCount || 0) - 1);
            block.updatedAt = now;
            await block.save(opts);
          }
        }

        result = await Resource.findByIdAndUpdate(
          id,
          { isInvalid: true, invalidatedAt: now, updatedAt: now },
          { new: true, ...opts },
        );
      };

      const useTransactions = env.NODE_ENV !== 'test' && await canUseTransactions();
      if (useTransactions) {
        try {
          await session.withTransaction(async () => {
            await applyDelete(session);
          });
        } catch (error) {
          if (!isTransactionUnsupportedError(error)) throw error;
          markTransactionsUnsupported();
          await applyDelete();
        }
      } else {
        await applyDelete();
      }
    } finally {
      await session.endSession();
    }

    return result;
  }

  private getStoragePath(sha256: string): string {
    const storageName = generateStorageName(sha256);
    const prefix1 = storageName.substring(0, 2);
    const secondChar = storageName.substring(2, 3);
    const relativePath = `${prefix1}/${secondChar}${storageName}`;
    return path.join(env.STORAGE_BLOCK_DIR, relativePath);
  }

  /**
   * Get resource metadata for download (totalSize, mime, filename, iv) without range validation.
   * Used by Range request handling to determine totalSize before parsing the Range header,
   * avoiding the need to call download() twice.
   */
  async downloadMeta(id: string): Promise<{ totalSize: number; mime: string; filename: string }> {
    const resource = await Resource.findOne({
      _id: id,
      isInvalid: { $ne: true },
    }).populate('block');

    if (!resource) {
      throw new DownloadError('Resource not found', 404);
    }

    const block = resource.block as IBlock;
    if (!block || typeof block !== 'object' || !('sha256' in block)) {
      throw new DownloadError(
        `Data inconsistency: Block reference for resource ${id} is invalid`,
        500,
        'INVALID_BLOCK_REF',
      );
    }

    return {
      totalSize: block.size,
      mime: resource.mime || 'application/octet-stream',
      filename: resource.name || 'download',
    };
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

    // Guard against null/invalid populated block reference
    if (!block || typeof block !== 'object' || !('sha256' in block)) {
      throw new DownloadError(
        `Data inconsistency: Block reference for resource ${id} is invalid`,
        500,
        'INVALID_BLOCK_REF',
      );
    }

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

    // Update lastAccessedAt - await to ensure consistency (per state-consistency rule)
    try {
      await Resource.findByIdAndUpdate(id, {
        lastAccessedAt: Date.now()
      });
    } catch (error) {
      // Log warning but don't fail the download
      console.warn(`[download] Failed to update lastAccessedAt for resource ${id}:`, error);
    }

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
