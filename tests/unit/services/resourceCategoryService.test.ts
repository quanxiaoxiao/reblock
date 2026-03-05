import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ResourceCategoryService,
  ResourceCategoryError,
  resourceCategoryService,
} from '../../../src/services/resourceCategoryService';
import { Resource, ResourceCategory } from '../../../src/models';

vi.mock('../../../src/models', () => ({
  Resource: {
    countDocuments: vi.fn(),
  },
  ResourceCategory: Object.assign(
    vi.fn(),
    {
      find: vi.fn(),
      findOne: vi.fn(),
      exists: vi.fn(),
    }
  ),
}));

describe('ResourceCategoryService', () => {
  let service: ResourceCategoryService;

  beforeEach(() => {
    service = new ResourceCategoryService();
    vi.clearAllMocks();
  });

  it('creates category with generated key', async () => {
    const mockSave = vi.fn().mockResolvedValue({
      _id: 'cat-1',
      key: 'documents',
      name: 'Documents',
    });

    (ResourceCategory.exists as any)
      .mockResolvedValueOnce(false);
    (ResourceCategory as any).mockImplementation(function(this: any, data: any) {
      Object.assign(this, data);
      this.save = mockSave;
    });

    const result = await service.create({ name: 'Documents' });

    expect(ResourceCategory.exists).toHaveBeenCalledWith({ key: 'documents', isInvalid: { $ne: true } });
    expect(mockSave).toHaveBeenCalled();
    expect(result.key).toBe('documents');
  });

  it('creates category with suffix when key conflicts', async () => {
    const mockSave = vi.fn().mockResolvedValue({
      _id: 'cat-2',
      key: 'documents-2',
      name: 'Documents',
    });

    (ResourceCategory.exists as any)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    (ResourceCategory as any).mockImplementation(function(this: any, data: any) {
      Object.assign(this, data);
      this.save = mockSave;
    });

    const result = await service.create({ name: 'Documents' });
    expect(result.key).toBe('documents-2');
  });

  it('rejects invalid color format', async () => {
    await expect(service.create({ name: 'Documents', color: 'red' })).rejects.toMatchObject({
      message: 'color must be a valid #RRGGBB hex value',
    });
  });

  it('rejects icon payload larger than 8KB', async () => {
    const oversized = Buffer.alloc(8193).toString('base64');
    await expect(
      service.create({ name: 'Documents', iconDataUri: `data:image/png;base64,${oversized}` })
    ).rejects.toMatchObject({
      message: 'iconDataUri exceeds max decoded size 8192 bytes',
    });
  });

  it('updates name without changing key', async () => {
    const mockSave = vi.fn().mockResolvedValue({
      _id: 'cat-1',
      key: 'documents',
      name: 'Docs',
    });

    (ResourceCategory.findOne as any).mockReturnValue({
      exec: vi.fn().mockResolvedValue({
        key: 'documents',
        name: 'Documents',
        save: mockSave,
      }),
    });

    const result = await service.update('documents', { name: 'Docs' });

    expect(result?.key).toBe('documents');
    expect(result?.name).toBe('Docs');
  });

  it('blocks delete when category is in use', async () => {
    (ResourceCategory.findOne as any).mockReturnValue({
      exec: vi.fn().mockResolvedValue({
        key: 'documents',
        save: vi.fn(),
      }),
    });
    (Resource.countDocuments as any).mockResolvedValue(1);

    await expect(service.delete('documents')).rejects.toMatchObject({
      statusCode: 409,
      code: 'CATEGORY_IN_USE',
    });
  });

  it('rejects reserved category key for resource assignment', async () => {
    await expect(service.ensureCategoryKeyExists('__none__')).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_CATEGORY_KEY',
    });
  });

  it('rejects missing category key', async () => {
    (ResourceCategory.exists as any).mockResolvedValue(null);

    await expect(service.ensureCategoryKeyExists('not-found')).rejects.toMatchObject({
      statusCode: 400,
      code: 'CATEGORY_NOT_FOUND',
    });
  });
});

describe('resourceCategoryService singleton', () => {
  it('is instance of ResourceCategoryService', () => {
    expect(resourceCategoryService).toBeInstanceOf(ResourceCategoryService);
  });
});

describe('ResourceCategoryError', () => {
  it('creates error with status/code', () => {
    const error = new ResourceCategoryError('bad', 400, 'BAD');
    expect(error.message).toBe('bad');
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('BAD');
  });
});
