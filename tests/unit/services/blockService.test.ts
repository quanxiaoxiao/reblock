import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BlockService, blockService } from '../../../src/services/blockService';
import { Block } from '../../../src/models';

// Mock the Block model - simplified approach
let mockBlockSave: ReturnType<typeof vi.fn>;

vi.mock('../../../src/models', () => ({
  Block: Object.assign(
    vi.fn(),
    {
      findOne: vi.fn(),
      find: vi.fn(),
      findByIdAndUpdate: vi.fn(),
      countDocuments: vi.fn(),
    }
  ),
}));

describe('BlockService', () => {
  let service: BlockService;

  beforeEach(() => {
    service = new BlockService();
    vi.clearAllMocks();
    
    // Create a fresh mock save for each test
    mockBlockSave = vi.fn();
    
    // Override the Block constructor to return an object with save method
    (Block as unknown as ReturnType<typeof vi.fn>).mockImplementation(function(this: Record<string, unknown>, data: Record<string, unknown>) {
      Object.assign(this, data);
      this.save = mockBlockSave;
      return this;
    });
  });

  describe('create', () => {
    it('should create a block with timestamps', async () => {
      const blockData = {
        sha256: 'abc123',
        linkCount: 1,
        size: 1024,
      };

      const savedBlock = {
        _id: 'block-id-1',
        ...blockData,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      mockBlockSave.mockResolvedValue(savedBlock);

      const result = await service.create(blockData);

      expect(result).toBeDefined();
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
      expect(mockBlockSave).toHaveBeenCalled();
    });
  });

  describe('getById', () => {
    const validObjectId = '69a3a59a7faa60991f3d2891';
    
    it('should return a block by id excluding soft-deleted', async () => {
      const mockBlock = {
        _id: validObjectId,
        sha256: 'abc123',
        isInvalid: false,
      };

      vi.mocked(Block.findOne).mockResolvedValue(mockBlock as never);

      const result = await service.getById(validObjectId);

      expect(Block.findOne).toHaveBeenCalledWith({
        _id: validObjectId,
        isInvalid: { $ne: true },
      });
      expect(result).toEqual(mockBlock);
    });

    it('should return null for non-existent block', async () => {
      vi.mocked(Block.findOne).mockResolvedValue(null as never);

      const result = await service.getById(validObjectId);

      expect(result).toBeNull();
    });

    it('should not return soft-deleted blocks', async () => {
      vi.mocked(Block.findOne).mockResolvedValue(null as never);

      const result = await service.getById(validObjectId);

      expect(Block.findOne).toHaveBeenCalledWith({
        _id: validObjectId,
        isInvalid: { $ne: true },
      });
      expect(result).toBeNull();
    });
  });

  describe('list', () => {
    it('should return all blocks without pagination', async () => {
      const mockBlocks = [
        { _id: '1', sha256: 'abc', createdAt: Date.now() },
        { _id: '2', sha256: 'def', createdAt: Date.now() },
      ];

      const mockSort = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue(mockBlocks),
      });
      vi.mocked(Block.find).mockReturnValue({ sort: mockSort } as never);

      const result = await service.list();

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.limit).toBeUndefined();
      expect(result.offset).toBeUndefined();
    });

    it('should return paginated results with limit and offset', async () => {
      const mockBlocks = [
        { _id: '1', sha256: 'abc', createdAt: Date.now() },
      ];

      const mockSort = vi.fn().mockReturnValue({
        skip: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            exec: vi.fn().mockResolvedValue(mockBlocks),
          }),
        }),
      });
      vi.mocked(Block.find).mockReturnValue({ sort: mockSort } as never);
      vi.mocked(Block.countDocuments).mockResolvedValue(10 as never);

      const result = await service.list({}, 5, 0);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(10);
      expect(result.limit).toBe(5);
      expect(result.offset).toBe(0);
    });

    it('should apply custom filter', async () => {
      const mockBlocks = [{ _id: '1', sha256: 'abc' }];
      const mockSort = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue(mockBlocks),
      });
      vi.mocked(Block.find).mockReturnValue({ sort: mockSort } as never);

      await service.list({ sha256: 'abc' });

      expect(Block.find).toHaveBeenCalledWith({
        sha256: 'abc',
        isInvalid: { $ne: true },
      });
    });

    it('should exclude soft-deleted blocks from results', async () => {
      const mockBlocks = [{ _id: '1', sha256: 'abc' }];
      const mockSort = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue(mockBlocks),
      });
      vi.mocked(Block.find).mockReturnValue({ sort: mockSort } as never);

      await service.list();

      const filterArg = vi.mocked(Block.find).mock.calls[0][0];
      expect(filterArg).toHaveProperty('isInvalid', { $ne: true });
    });
  });

  describe('update', () => {
    it('should update a block and set updatedAt timestamp', async () => {
      const updateData = { sha256: 'new-sha256' };
      const updatedBlock = {
        _id: 'block-id-1',
        sha256: 'new-sha256',
        updatedAt: Date.now(),
      };

      vi.mocked(Block.findByIdAndUpdate).mockResolvedValue(updatedBlock as never);

      const result = await service.update('block-id-1', updateData);

      expect(Block.findByIdAndUpdate).toHaveBeenCalledWith(
        'block-id-1',
        {
          sha256: 'new-sha256',
          updatedAt: expect.any(Number),
        },
        { new: true }
      );
      expect(result).toEqual(updatedBlock);
    });

    it('should remove server-controlled fields from input', async () => {
      const updateData = {
        sha256: 'new-sha256',
        createdAt: 123456,
        updatedAt: 123456,
        invalidatedAt: 123456,
      };

      vi.mocked(Block.findByIdAndUpdate).mockResolvedValue({} as never);

      await service.update('block-id-1', updateData);

      const updateArg = vi.mocked(Block.findByIdAndUpdate).mock.calls[0][1] as Record<string, unknown>;
      expect(updateArg).not.toHaveProperty('createdAt', 123456);
      expect(updateArg).not.toHaveProperty('invalidatedAt', 123456);
      expect(updateArg).toHaveProperty('updatedAt');
    });

    it('should return null for non-existent block', async () => {
      vi.mocked(Block.findByIdAndUpdate).mockResolvedValue(null as never);

      const result = await service.update('non-existent-id', { sha256: 'test' });

      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('should perform soft delete with timestamps', async () => {
      const deletedBlock = {
        _id: 'block-id-1',
        sha256: 'abc123',
        isInvalid: true,
        invalidatedAt: Date.now(),
        updatedAt: Date.now(),
      };

      vi.mocked(Block.findByIdAndUpdate).mockResolvedValue(deletedBlock as never);

      const result = await service.delete('block-id-1');

      expect(Block.findByIdAndUpdate).toHaveBeenCalledWith(
        'block-id-1',
        {
          isInvalid: true,
          invalidatedAt: expect.any(Number),
          updatedAt: expect.any(Number),
        },
        { new: true }
      );
      expect(result).toEqual(deletedBlock);
      expect(result?.isInvalid).toBe(true);
      expect(result?.invalidatedAt).toBeDefined();
    });

    it('should return null for non-existent block', async () => {
      vi.mocked(Block.findByIdAndUpdate).mockResolvedValue(null as never);

      const result = await service.delete('non-existent-id');

      expect(result).toBeNull();
    });
  });
});

describe('blockService singleton', () => {
  it('should be an instance of BlockService', () => {
    expect(blockService).toBeInstanceOf(BlockService);
  });
});
