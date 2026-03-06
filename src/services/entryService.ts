import { Entry, Resource, Block } from '../models';
import type { IEntry } from '../models';
import type { PaginatedResult } from './types';
import { validatePagination } from '../utils/pagination';
import { logService } from './logService';
import { LogLevel, LogCategory, DataLossRisk } from '../models/logEntry';
import mongoose from 'mongoose';
import { canUseTransactions, isTransactionUnsupportedError, markTransactionsUnsupported } from '../utils/transaction';

// MongoDB filter type - allows flexible query objects
type MongoFilter = Record<string, unknown>;
type EntryListOptions = {
  includeChildrenCount?: boolean;
};

export class BusinessError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
    this.name = 'BusinessError';
  }
}

export interface IEntryService {
  create(entryData: Partial<IEntry>): Promise<IEntry>;
  update(id: string, entryData: Partial<IEntry>): Promise<IEntry | null>;
  getById(id: string): Promise<IEntry | null>;
  getDefault(): Promise<IEntry | null>;
  list(filter?: MongoFilter, limit?: number, offset?: number, options?: EntryListOptions): Promise<PaginatedResult<IEntry>>;
  delete(id: string): Promise<IEntry | null>;
}

export class EntryService implements IEntryService {
  async create(entryData: Partial<IEntry>): Promise<IEntry> {
    const normalizedParentEntryId = await this.normalizeParentEntryId((entryData as Record<string, unknown>)['parentEntryId']);
    if (normalizedParentEntryId) {
      await this.assertParentExists(normalizedParentEntryId);
    }

    // Business uniqueness check for alias (per business-uniqueness.rule.md)
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

    // Service layer injects timestamps (per timestamp-soft-delete rule)
    const dataWithTimestamps = {
      ...entryData,
      parentEntryId: normalizedParentEntryId === undefined ? (entryData as Record<string, unknown>)['parentEntryId'] : normalizedParentEntryId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const entry = new Entry(dataWithTimestamps);
    const savedEntry = await entry.save();
    return savedEntry;
  }

  async update(id: string, entryData: Partial<IEntry>): Promise<IEntry | null> {
    // First check if entry exists and is not soft-deleted
    const existingEntry = await Entry.findOne({ _id: id, isInvalid: { $ne: true } });
    if (!existingEntry) {
      return null;
    }

    // Business uniqueness check for alias (per business-uniqueness.rule.md)
    if (entryData.alias && entryData.alias !== existingEntry.alias) {
      const duplicate = await Entry.findOne({
        _id: { $ne: id },
        alias: entryData.alias,
        isInvalid: { $ne: true }
      });
      if (duplicate) {
        throw new BusinessError('alias already exists', 409);
      }
    }

    // If setting as default and it's different from current state, unset any existing default first
    if (entryData.isDefault === true && existingEntry.isDefault !== true) {
      await Entry.updateMany(
        { _id: { $ne: id }, isDefault: true, isInvalid: false },
        { isDefault: false, updatedAt: Date.now() }
      );
    }

    // Remove server-controlled fields from input
    const safeData = { ...entryData };
    delete (safeData as Record<string, unknown>)['createdAt'];
    delete (safeData as Record<string, unknown>)['updatedAt'];
    delete (safeData as Record<string, unknown>)['invalidatedAt'];

    const normalizedParentEntryId = await this.normalizeParentEntryId((safeData as Record<string, unknown>)['parentEntryId']);
    if (normalizedParentEntryId !== undefined) {
      if (normalizedParentEntryId === null) {
        (safeData as Record<string, unknown>)['parentEntryId'] = null;
      } else {
        await this.assertNoCycle(id, normalizedParentEntryId);
        (safeData as Record<string, unknown>)['parentEntryId'] = normalizedParentEntryId;
      }
    }

    const updatedEntry = await Entry.findByIdAndUpdate(
      id,
      {
        ...safeData,
        updatedAt: Date.now(),
      },
      { new: true }
    );

    return updatedEntry;
  }

  async getById(id: string): Promise<IEntry | null> {
    const isValidObjectId = mongoose.isValidObjectId(id);
    const query = isValidObjectId
      ? { _id: id, isInvalid: { $ne: true } }
      : { alias: id, isInvalid: { $ne: true } };
    return Entry.findOne(query);
  }

  async getDefault(): Promise<IEntry | null> {
    return Entry.findOne({ isDefault: true, isInvalid: { $ne: true } });
  }

  async getOrCreateDefault(): Promise<IEntry> {
    const existing = await Entry.findOne({ isDefault: true, isInvalid: { $ne: true } });
    if (existing) return existing;

    const entry = new Entry({
      name: 'Default',
      alias: 'default',
      isDefault: true,
      description: 'Default entry',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    try {
      return await entry.save();
    } catch (err: unknown) {
      const duplicateKeyError = err as { code?: number };
      if (duplicateKeyError.code === 11000) {
        const existing = await Entry.findOne({ isDefault: true, isInvalid: { $ne: true } });
        if (existing) return existing;
      }
      throw err;
    }
  }

  async list(
    filter: MongoFilter = {},
    limit?: number,
    offset?: number,
    options: EntryListOptions = {}
  ): Promise<PaginatedResult<IEntry>> {
    const safeFilter = { ...filter, isInvalid: { $ne: true } };

    // Check if pagination is requested
    const isPaginated = limit !== undefined || offset !== undefined;

    if (isPaginated) {
      // Validate pagination parameters
      const { limit: safeLimit, offset: safeOffset } = validatePagination({ limit, offset });

      // Apply stable ordering for pagination (createdAt DESC, _id DESC as tie-breaker)
      const [items, total] = await Promise.all([
        Entry.find(safeFilter)
          .sort({ createdAt: -1, _id: -1 })
          .skip(safeOffset)
          .limit(safeLimit)
          .exec(),
        Entry.countDocuments(safeFilter)
      ]);

      const enrichedItems = await this.attachChildrenCountIfRequested(items, options.includeChildrenCount);

      return {
        items: enrichedItems,
        total,
        limit: safeLimit,
        offset: safeOffset
      };
    }

    // Non-paginated: return all items with total count
    const items = await Entry.find(safeFilter).sort({ createdAt: -1, _id: -1 }).exec();
    const enrichedItems = await this.attachChildrenCountIfRequested(items, options.includeChildrenCount);
    return {
      items: enrichedItems,
      total: enrichedItems.length
    };
  }
  
  async delete(id: string): Promise<IEntry | null> {
    // First check if entry exists and is not soft-deleted
    const existingEntry = await Entry.findOne({ _id: id, isInvalid: { $ne: true } });
    if (!existingEntry) {
      return null;
    }

    const hasChildren = await Entry.exists({
      parentEntryId: id,
      isInvalid: { $ne: true },
    });
    if (hasChildren) {
      try {
        await logService.logAction({
          action: 'entry_delete_blocked_has_children',
          success: false,
          entryIds: [id],
          details: {
            entryId: id,
          },
          note: 'Entry delete blocked because it still has active children',
          actor: 'entry-service',
        });
      } catch {
        // Best effort logging, business result should still be returned.
      }
      throw new BusinessError('entry has children', 409);
    }

    // Find all associated resources that are not soft-deleted
    const associatedResources = await Resource.find({
      entry: id,
      isInvalid: { $ne: true }
    });

    // Batch-load all referenced blocks to avoid N+1 queries
    const blockIds = [...new Set(associatedResources.map(r => r.block.toString()))];
    const blocks = await Block.find({ _id: { $in: blockIds } });
    const blockMap = new Map(blocks.map(b => [b._id.toString(), b]));

    // Build linkCount changes for logging
    // Count how many resources reference each block (a block can be referenced multiple times)
    const blockRefCounts = new Map<string, number>();
    for (const resource of associatedResources) {
      const bid = resource.block.toString();
      blockRefCounts.set(bid, (blockRefCounts.get(bid) || 0) + 1);
    }

    const blockLinkCountChanges: Array<{
      blockId: string;
      oldLinkCount: number;
      newLinkCount: number;
    }> = [];

    for (const [bid, refCount] of blockRefCounts) {
      const block = blockMap.get(bid);
      if (block) {
        blockLinkCountChanges.push({
          blockId: bid,
          oldLinkCount: block.linkCount,
          newLinkCount: Math.max(0, block.linkCount - refCount),
        });
      }
    }

    // Log the cascade delete action for potential recovery
    await logService.logIssue({
      level: LogLevel.WARNING,
      category: LogCategory.CLEANUP_ACTION,
      entryIds: [id],
      resourceIds: associatedResources.map(r => r._id.toString()),
      details: {
        operation: 'cascade_soft_delete_entry',
        deletedEntry: {
          _id: existingEntry._id.toString(),
          name: existingEntry.name,
          alias: existingEntry.alias,
          isDefault: existingEntry.isDefault,
          description: existingEntry.description,
          createdAt: existingEntry.createdAt,
          updatedAt: existingEntry.updatedAt,
        },
        deletedResources: associatedResources.map(r => ({
          _id: r._id.toString(),
          block: r.block.toString(),
          name: r.name,
          description: r.description,
          mime: r.mime,
          categoryKey: r.categoryKey,
          createdAt: r.createdAt,
        })),
        blockLinkCountChanges,
      },
      suggestedAction: 'Can be recovered via restore script',
      recoverable: true,
      dataLossRisk: DataLossRisk.NONE,
      recoverySteps: [
        '1. Update Entry: set isInvalid=false, invalidatedAt=null',
        '2. Bulk update Resources: set isInvalid=false, invalidatedAt=null',
        '3. Restore Block linkCount values',
      ],
      context: {
        detectedBy: 'system',
        detectedAt: Date.now(),
      },
    });

    const session = await mongoose.startSession();
    let updatedEntry: IEntry | null = null;

    try {
      const applyDelete = async (sessionArg?: mongoose.ClientSession): Promise<void> => {
        const now = Date.now();
        const findOptions = sessionArg ? { session: sessionArg } : undefined;
        const saveOptions = sessionArg ? { session: sessionArg } : undefined;

        // Soft delete the entry
        updatedEntry = await Entry.findByIdAndUpdate(
          id,
          {
            isInvalid: true,
            invalidatedAt: now,
            updatedAt: now,
          },
          { new: true, ...saveOptions }
        );

        // Soft delete all associated resources in bulk
        if (associatedResources.length > 0) {
          await Resource.updateMany(
            { _id: { $in: associatedResources.map(r => r._id) } },
            { isInvalid: true, invalidatedAt: now, updatedAt: now },
            saveOptions,
          );
        }

        // Decrement block linkCounts using pre-fetched blockRefCounts (avoids N+1 queries)
        for (const [bid, refCount] of blockRefCounts) {
          const block = sessionArg
            ? await Block.findOne({ _id: bid, isInvalid: { $ne: true } }, null, findOptions)
            : blockMap.get(bid);
          if (block && !block.isInvalid) {
            block.linkCount = Math.max(0, (block.linkCount || 0) - refCount);
            block.updatedAt = now;
            await block.save(saveOptions);
          }
        }
      };

      const useTransactions = await canUseTransactions();
      if (useTransactions) {
        try {
          await session.withTransaction(async () => {
            await applyDelete(session);
          });
        } catch (error) {
          // Fallback for non-replica-set MongoDB (common in local/dev containers).
          if (!isTransactionUnsupportedError(error)) {
            throw error;
          }
          markTransactionsUnsupported();
          await applyDelete();
        }
      } else {
        await applyDelete();
      }
    } finally {
      await session.endSession();
    }

    return updatedEntry;
  }

  private async normalizeParentEntryId(parentEntryId: unknown): Promise<string | null | undefined> {
    if (parentEntryId === undefined) {
      return undefined;
    }
    if (parentEntryId === null || parentEntryId === '') {
      return null;
    }

    const id = String(parentEntryId);
    if (!mongoose.isValidObjectId(id)) {
      throw new BusinessError('parentEntryId is invalid', 400);
    }
    return id;
  }

  private async assertParentExists(parentEntryId: string): Promise<void> {
    const parentEntry = await Entry.findOne({
      _id: parentEntryId,
      isInvalid: { $ne: true },
    });
    if (!parentEntry) {
      throw new BusinessError('parent entry not found', 400);
    }
  }

  private async assertNoCycle(entryId: string, parentEntryId: string): Promise<void> {
    if (entryId === parentEntryId) {
      throw new BusinessError('parentEntryId cannot reference itself', 400);
    }

    let cursor: string | null = parentEntryId;
    while (cursor) {
      const ancestor = await Entry.findOne(
        { _id: cursor, isInvalid: { $ne: true } },
        { _id: 1, parentEntryId: 1 }
      ) as { _id: mongoose.Types.ObjectId; parentEntryId?: mongoose.Types.ObjectId | null } | null;

      if (!ancestor) {
        throw new BusinessError('parent entry not found', 400);
      }

      const ancestorId = ancestor._id.toString();
      if (ancestorId === entryId) {
        throw new BusinessError('parentEntryId would create a cycle', 400);
      }

      cursor = ancestor.parentEntryId ? ancestor.parentEntryId.toString() : null;
    }
  }

  private async attachChildrenCountIfRequested(
    items: IEntry[],
    includeChildrenCount?: boolean
  ): Promise<IEntry[]> {
    if (!includeChildrenCount || items.length === 0) {
      return items;
    }

    const ids = items.map(item => item._id);
    const counts = await Entry.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
      {
        $match: {
          isInvalid: { $ne: true },
          parentEntryId: { $in: ids },
        },
      },
      {
        $group: {
          _id: '$parentEntryId',
          count: { $sum: 1 },
        },
      },
    ]);

    const countMap = new Map<string, number>();
    for (const row of counts) {
      countMap.set(row._id.toString(), row.count);
    }

    return items.map((item) => {
      const plain = typeof (item as unknown as { toObject?: () => Record<string, unknown> }).toObject === 'function'
        ? (item as unknown as { toObject: () => Record<string, unknown> }).toObject()
        : { ...(item as unknown as Record<string, unknown>) };
      plain['childrenCount'] = countMap.get(item._id.toString()) || 0;
      return plain as unknown as IEntry;
    });
  }
}

export const entryService = new EntryService();
