import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResourceService, resourceService, DownloadError, ResourceMutationError } from '../../../src/services/resourceService';
import { Resource, Block, Entry, ResourceHistory } from '../../../src/models';
import fs from 'fs/promises';
import { logService } from '../../../src/services/logService';
import { resourceCategoryService } from '../../../src/services/resourceCategoryService';

// Mock dependencies
vi.mock('../../../src/models', () => ({
  Resource: Object.assign(
    vi.fn(),
    {
      findOne: vi.fn(),
      find: vi.fn(),
      findByIdAndUpdate: vi.fn(),
      countDocuments: vi.fn(),
    }
  ),
  Block: Object.assign(
    vi.fn(),
    {
      findOne: vi.fn(),
    }
  ),
  Entry: {
    findOne: vi.fn(),
  },
  ResourceHistory: Object.assign(
    vi.fn(),
    {
      findOne: vi.fn(),
      find: vi.fn(),
      countDocuments: vi.fn(),
    }
  ),
}));

vi.mock('fs/promises', () => ({
  default: {
    stat: vi.fn(),
    access: vi.fn(),
  },
}));

vi.mock('../../../src/config/env', () => ({
  env: {
    STORAGE_BLOCK_DIR: '/storage/blocks',
    STORAGE_TEMP_DIR: '/storage/_temp',
    STORAGE_LOG_DIR: '/storage/_logs',
    NODE_ENV: 'test',
    LOG_TTL_DAYS: 90,
    LOG_ARCHIVE_DAYS: 30,
  },
}));

vi.mock('../../../src/services/logService', () => ({
  logService: {
    logIssue: vi.fn().mockResolvedValue({}),
    logAction: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../../../src/services/resourceCategoryService', () => ({
  resourceCategoryService: {
    ensureCategoryKeyExists: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../src/utils/crypto', () => ({
  generateStorageName: vi.fn((sha256: string) => `storage_${sha256.substring(0, 16)}`),
  generateIV: vi.fn(() => Buffer.from('1234567890123456')), // 16-byte IV
}));

vi.mock('../../../src/models/logEntry', () => ({
  LogLevel: {
    CRITICAL: 'CRITICAL',
    ERROR: 'ERROR',
    WARNING: 'WARNING',
    INFO: 'INFO',
  },
  LogCategory: {
    FILE_SIZE_MISMATCH: 'FILE_SIZE_MISMATCH',
    RUNTIME_ERROR: 'RUNTIME_ERROR',
  },
  DataLossRisk: {
    NONE: 'none',
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
  },
}));

describe('ResourceService', () => {
  let service: ResourceService;

  beforeEach(() => {
    service = new ResourceService();
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('should create a resource with timestamps', async () => {
      const resourceData = {
        name: 'Test Resource',
        mime: 'image/png',
      };

      const mockSavedResource = {
        _id: 'resource-id-1',
        ...resourceData,
        createdAt: expect.any(Number),
        updatedAt: expect.any(Number),
        lastAccessedAt: expect.any(Number),
      };

      const mockSave = vi.fn().mockResolvedValue(mockSavedResource);
      (Resource as any).mockImplementation(function(this: any, data: any) {
        Object.assign(this, data);
        this.save = mockSave;
      });

      const result = await service.create(resourceData);

      expect(Resource).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Test Resource',
        mime: 'image/png',
        createdAt: expect.any(Number),
        updatedAt: expect.any(Number),
        lastAccessedAt: expect.any(Number),
      }));
      expect(resourceCategoryService.ensureCategoryKeyExists).toHaveBeenCalledWith(undefined);
      expect(mockSave).toHaveBeenCalled();
      expect(result).toEqual(mockSavedResource);
    });

    it('should handle save errors', async () => {
      const resourceData = { name: 'Test Resource' };
      const mockSave = vi.fn().mockRejectedValue(new Error('Database error'));
      
      (Resource as any).mockImplementation(function(this: any, data: any) {
        Object.assign(this, data);
        this.save = mockSave;
      });

      await expect(service.create(resourceData)).rejects.toThrow('Database error');
    });
  });

  describe('getById', () => {
    it('should return null for invalid ObjectId', async () => {
      const result = await service.getById('invalid-id');
      expect(result).toBeNull();
    });
  });

  describe('list', () => {
    it('should return empty result when entryAlias not found', async () => {
      (Entry.findOne as any).mockResolvedValue(null);

      const result = await service.list({ entryAlias: 'non-existent' });

      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe('update', () => {
    it('should return null for non-existent resource', async () => {
      (Resource.findOne as any).mockResolvedValue(null);

      const result = await service.update('507f1f77bcf86cd799439011', { name: 'New Name' });

      expect(resourceCategoryService.ensureCategoryKeyExists).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('should reject block update via PUT flow', async () => {
      (Resource.findOne as any).mockResolvedValue({ _id: 'resource-id-1' });

      await expect(
        service.update('507f1f77bcf86cd799439011', { block: '507f1f77bcf86cd799439022' } as any)
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'IMMUTABLE_BLOCK',
      });
    });

    it('should validate target entry when updating entry field', async () => {
      (Resource.findOne as any).mockResolvedValue({ _id: 'resource-id-1' });
      (Entry.findOne as any).mockReturnValue({
        exec: vi.fn().mockResolvedValue({ _id: '507f1f77bcf86cd799439013' }),
      });
      (Resource.findByIdAndUpdate as any).mockResolvedValue({ _id: 'resource-id-1', entry: '507f1f77bcf86cd799439013' });

      const result = await service.update('507f1f77bcf86cd799439011', { entry: '507f1f77bcf86cd799439013' } as any);

      expect(Entry.findOne).toHaveBeenCalled();
      expect(resourceCategoryService.ensureCategoryKeyExists).toHaveBeenCalledWith(undefined);
      expect(result).toEqual({ _id: 'resource-id-1', entry: '507f1f77bcf86cd799439013' });
    });

    it('should fail when target entry does not exist', async () => {
      (Resource.findOne as any).mockResolvedValue({ _id: 'resource-id-1' });
      (Entry.findOne as any).mockReturnValue({
        exec: vi.fn().mockResolvedValue(null),
      });

      await expect(
        service.update('507f1f77bcf86cd799439011', { entry: '507f1f77bcf86cd799439013' } as any)
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'ENTRY_NOT_FOUND',
      });
    });
  });

  describe('delete', () => {
    it('should return null for non-existent resource', async () => {
      (Resource.findOne as any).mockResolvedValue(null);

      const result = await service.delete('507f1f77bcf86cd799439011');

      expect(result).toBeNull();
    });
  });

  describe('updateBlock', () => {
    it('should throw error for invalid resource id', async () => {
      await expect(service.updateBlock('invalid-id', { newBlockId: '507f1f77bcf86cd799439022' }))
        .rejects
        .toThrow(ResourceMutationError);
      
      await expect(service.updateBlock('invalid-id', { newBlockId: '507f1f77bcf86cd799439022' }))
        .rejects
        .toThrow('Invalid resource id');
    });

    it('should throw error for invalid block id', async () => {
      await expect(service.updateBlock('507f1f77bcf86cd799439011', { newBlockId: 'invalid-id' }))
        .rejects
        .toThrow(ResourceMutationError);
      
      await expect(service.updateBlock('507f1f77bcf86cd799439011', { newBlockId: 'invalid-id' }))
        .rejects
        .toThrow('Invalid block id');
    });
  });

  describe('rollbackBlock', () => {
    it('should throw error for invalid resource id', async () => {
      await expect(service.rollbackBlock('invalid-id', '507f1f77bcf86cd799439044'))
        .rejects
        .toThrow('Invalid resource id');
    });

    it('should throw error for invalid history id', async () => {
      await expect(service.rollbackBlock('507f1f77bcf86cd799439011', 'invalid-id'))
        .rejects
        .toThrow('Invalid history id');
    });
  });

  describe('getHistory', () => {
    it('should throw error for invalid resource id', async () => {
      await expect(service.getHistory('invalid-id'))
        .rejects
        .toThrow('Invalid resource id');
    });
  });
});

describe('resourceService singleton', () => {
  it('should be an instance of ResourceService', () => {
    expect(resourceService).toBeInstanceOf(ResourceService);
  });
});

describe('DownloadError', () => {
  it('should create error with message and status code', () => {
    const error = new DownloadError('Test error', 404);
    expect(error.message).toBe('Test error');
    expect(error.statusCode).toBe(404);
    expect(error.name).toBe('DownloadError');
  });

  it('should include code when provided', () => {
    const error = new DownloadError('Test error', 500, 'DATA_INCONSISTENCY');
    expect(error.code).toBe('DATA_INCONSISTENCY');
  });
});

describe('ResourceMutationError', () => {
  it('should create error with message, status code and code', () => {
    const error = new ResourceMutationError('Mutation failed', 400, 'INVALID_ID');
    expect(error.message).toBe('Mutation failed');
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('INVALID_ID');
    expect(error.name).toBe('ResourceMutationError');
  });
});
