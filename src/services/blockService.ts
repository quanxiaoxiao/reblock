import mongoose from 'mongoose';
import { Block } from '../models';
import type { IBlock } from '../models';
import type { PaginatedResult } from './types';
import { validatePagination } from '../utils/pagination';

// MongoDB filter type - allows flexible query objects
type MongoFilter = Record<string, unknown>;

export interface IBlockService {
  create(blockData: Partial<IBlock>): Promise<IBlock>;
  update(id: string, blockData: Partial<IBlock>): Promise<IBlock | null>;
  getById(id: string): Promise<IBlock | null>;
  list(filter?: MongoFilter, limit?: number, offset?: number): Promise<PaginatedResult<IBlock>>;
  delete(id: string): Promise<IBlock | null>;
}

export class BlockService implements IBlockService {
  async create(blockData: Partial<IBlock>): Promise<IBlock> {
    // Service layer injects timestamps (per timestamp-soft-delete rule)
    const dataWithTimestamps = {
      ...blockData,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const block = new Block(dataWithTimestamps);
    const savedBlock = await block.save();
    return savedBlock;
  }

  async update(id: string, blockData: Partial<IBlock>): Promise<IBlock | null> {
    // Check if block exists and is not soft-deleted
    const existingBlock = await Block.findOne({ _id: id, isInvalid: { $ne: true } });
    if (!existingBlock) {
      return null;
    }

    // Remove server-controlled fields from input
    const safeData = { ...blockData };
    delete (safeData as Record<string, unknown>).createdAt;
    delete (safeData as Record<string, unknown>).updatedAt;
    delete (safeData as Record<string, unknown>).invalidatedAt;

    const updatedBlock = await Block.findByIdAndUpdate(
      id,
      {
        ...safeData,
        updatedAt: Date.now(),
      },
      { new: true }
    );

    return updatedBlock;
  }

  async getById(id: string): Promise<IBlock | null> {
    if (!mongoose.isValidObjectId(id)) {
      return null;
    }
    return Block.findOne({ _id: id, isInvalid: { $ne: true } });
  }

  async list(filter: MongoFilter = {}, limit?: number, offset?: number): Promise<PaginatedResult<IBlock>> {
    const safeFilter = { ...filter, isInvalid: { $ne: true } };

    // Check if pagination is requested
    const isPaginated = limit !== undefined || offset !== undefined;

    if (isPaginated) {
      // Validate pagination parameters
      const { limit: safeLimit, offset: safeOffset } = validatePagination({ limit, offset });

      // Apply stable ordering for pagination (createdAt DESC, _id DESC as tie-breaker)
      const [items, total] = await Promise.all([
        Block.find(safeFilter)
          .sort({ createdAt: -1, _id: -1 })
          .skip(safeOffset)
          .limit(safeLimit)
          .exec(),
        Block.countDocuments(safeFilter)
      ]);

      return {
        items,
        total,
        limit: safeLimit,
        offset: safeOffset
      };
    }

    // Non-paginated: return all items with total count
    const items = await Block.find(safeFilter).sort({ createdAt: -1, _id: -1 }).exec();
    return {
      items,
      total: items.length
    };
  }
  
  async delete(id: string): Promise<IBlock | null> {
    // Check if block exists and is not soft-deleted
    const existingBlock = await Block.findOne({ _id: id, isInvalid: { $ne: true } });
    if (!existingBlock) {
      return null;
    }

    return Block.findByIdAndUpdate(
      id,
      {
        isInvalid: true,
        invalidatedAt: Date.now(),
        updatedAt: Date.now(),
      },
      { new: true }
    );
  }
}

export const blockService = new BlockService();
