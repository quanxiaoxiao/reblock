import { Entry, Resource, Block } from '../models';
import type { IEntry } from '../models';
import type { PaginatedResult } from './types';
import { validatePagination } from '../utils/pagination';
import { logService } from './logService';
import { LogLevel, LogCategory, DataLossRisk } from '../models/logEntry';
import mongoose from 'mongoose';

// MongoDB filter type - allows flexible query objects
type MongoFilter = Record<string, unknown>;

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
  list(filter?: MongoFilter, limit?: number, offset?: number): Promise<PaginatedResult<IEntry>>;
  delete(id: string): Promise<IEntry | null>;
}

export class EntryService implements IEntryService {
  private transactionsSupported: boolean | null = null;

  private async canUseTransactions(): Promise<boolean> {
    if (this.transactionsSupported !== null) {
      return this.transactionsSupported;
    }

    try {
      const admin = mongoose.connection.db?.admin();
      if (!admin) {
        this.transactionsSupported = false;
        return false;
      }
      const hello = await admin.command({ hello: 1 });
      const isReplicaSet = Boolean(hello?.setName);
      const isMongos = hello?.msg === 'isdbgrid';
      this.transactionsSupported = isReplicaSet || isMongos;
      return this.transactionsSupported;
    } catch {
      this.transactionsSupported = false;
      return false;
    }
  }

  private isTransactionUnsupportedError(error: unknown): boolean {
    const errorLike = error as { message?: string; code?: number; codeName?: string };
    const message = (errorLike?.message || '').toLowerCase();
    const codeName = (errorLike?.codeName || '').toLowerCase();
    const code = errorLike?.code;
    if (!message && !codeName && typeof code !== 'number') return false;
    return (
      message.includes('transaction numbers are only allowed on a replica set member') ||
      message.includes('transaction numbers are only allowed on a mongos') ||
      message.includes('transactions are not supported') ||
      message.includes('standalone servers do not support transactions') ||
      message.includes('current topology does not support sessions') ||
      message.includes('this deployment does not support retryable writes') ||
      codeName.includes('illegaloperation') ||
      codeName.includes('nosuchtransaction') ||
      code === 20
    );
  }
  async create(entryData: Partial<IEntry>): Promise<IEntry> {
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
    delete (safeData as Record<string, unknown>).createdAt;
    delete (safeData as Record<string, unknown>).updatedAt;
    delete (safeData as Record<string, unknown>).invalidatedAt;

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
    } catch (err: any) {
      if (err.code === 11000) {
        const existing = await Entry.findOne({ isDefault: true, isInvalid: { $ne: true } });
        if (existing) return existing;
      }
      throw err;
    }
  }

  async list(filter: MongoFilter = {}, limit?: number, offset?: number): Promise<PaginatedResult<IEntry>> {
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

      return {
        items,
        total,
        limit: safeLimit,
        offset: safeOffset
      };
    }

    // Non-paginated: return all items with total count
    const items = await Entry.find(safeFilter).sort({ createdAt: -1, _id: -1 }).exec();
    return {
      items,
      total: items.length
    };
  }
  
  async delete(id: string): Promise<IEntry | null> {
    // First check if entry exists and is not soft-deleted
    const existingEntry = await Entry.findOne({ _id: id, isInvalid: { $ne: true } });
    if (!existingEntry) {
      return null;
    }

    // Find all associated resources that are not soft-deleted
    const associatedResources = await Resource.find({
      entry: id,
      isInvalid: { $ne: true }
    });

    // Get block linkCount changes for logging
    const blockLinkCountChanges: Array<{
      blockId: string;
      oldLinkCount: number;
      newLinkCount: number;
    }> = [];

    for (const resource of associatedResources) {
      const block = await Block.findById(resource.block);
      if (block) {
        blockLinkCountChanges.push({
          blockId: block._id.toString(),
          oldLinkCount: block.linkCount,
          newLinkCount: block.linkCount - 1
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
          category: r.category,
          createdAt: r.createdAt,
        })),
        blockLinkCountChanges,
      },
      suggestedAction: '可通过恢复脚本恢复此操作',
      recoverable: true,
      dataLossRisk: DataLossRisk.NONE,
      recoverySteps: [
        '1. 更新 Entry: isInvalid=false, invalidatedAt=null',
        '2. 批量更新 Resource: isInvalid=false, invalidatedAt=null',
        '3. 恢复 Block linkCount',
      ],
      context: {
        detectedBy: 'system',
        detectedAt: Date.now(),
      },
    });

    const session = await mongoose.startSession();
    let updatedEntry: IEntry | null = null;

    try {
      const applyDelete = async (sessionArg?: mongoose.ClientSession) => {
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

        // Soft delete associated resources and decrement block linkCount
        for (const resource of associatedResources) {
          await Resource.findByIdAndUpdate(
            resource._id,
            {
              isInvalid: true,
              invalidatedAt: now,
              updatedAt: now,
            },
            saveOptions
          );

          const block = await Block.findOne(
            { _id: resource.block, isInvalid: { $ne: true } },
            null,
            findOptions
          );
          if (block) {
            block.linkCount = Math.max(0, (block.linkCount || 0) - 1);
            block.updatedAt = now;
            await block.save(saveOptions);
          }
        }
      };

      const useTransactions = await this.canUseTransactions();
      if (useTransactions) {
        try {
          await session.withTransaction(async () => {
            await applyDelete(session);
          });
        } catch (error) {
          // Fallback for non-replica-set MongoDB (common in local/dev containers).
          if (!this.isTransactionUnsupportedError(error)) {
            throw error;
          }
          this.transactionsSupported = false;
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
}

export const entryService = new EntryService();
