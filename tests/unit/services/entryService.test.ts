import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EntryService, entryService, BusinessError } from '../../../src/services/entryService';
import { Entry, Resource, Block } from '../../../src/models';

// Mock logService
vi.mock('../../../src/services/logService', () => ({
  logService: {
    logIssue: vi.fn().mockResolvedValue({}),
  },
}));

// Mock mongoose - must be defined inline since vi.mock is hoisted
vi.mock('mongoose', async () => {
  const actual = await vi.importActual('mongoose');
  const mockSession = {
    withTransaction: vi.fn().mockImplementation(async (fn) => fn()),
    endSession: vi.fn().mockResolvedValue(undefined),
  };
  return {
    ...actual as object,
    startSession: vi.fn(() => mockSession),
    default: {
      ...(actual as any).default,
      startSession: vi.fn(() => mockSession),
    },
  };
});





// Mock the Entry, Resource, and Block models
vi.mock('../../../src/models', () => ({
  Entry: Object.assign(
    vi.fn(),
    {
      findOne: vi.fn(),
      find: vi.fn(),
      findByIdAndUpdate: vi.fn(),
      updateMany: vi.fn(),
      countDocuments: vi.fn(),
    }
  ),
  Resource: Object.assign(
    vi.fn(),
    {
      find: vi.fn(),
      findByIdAndUpdate: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    }
  ),
  Block: Object.assign(
    vi.fn(),
    {
      find: vi.fn().mockResolvedValue([]),
      findById: vi.fn(),
      findOne: vi.fn(),
      findByIdAndUpdate: vi.fn(),
    }
  ),
}));

describe('EntryService', () => {
  let service: EntryService;
  let mockSave: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    service = new EntryService();
    vi.clearAllMocks();
    // Disable transactions for tests to avoid session mocking complexity
    (service as any).transactionsSupported = false;
    // Create a fresh mock save for each test
    mockSave = vi.fn();
    // Override the Entry constructor to return an object with save method
    (Entry as unknown as ReturnType<typeof vi.fn>).mockImplementation(function(this: Record<string, unknown>, data: Record<string, unknown>) {
      Object.assign(this, data);
      this.save = mockSave;
      return this;
    });
  });

  describe('create', () => {
    it('should create an entry with timestamps', async () => {
      const entryData = {
        name: 'Test Entry',
        alias: 'test-alias',
      };

      const savedEntry = {
        _id: 'entry-id-1',
        ...entryData,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      vi.mocked(Entry.findOne).mockResolvedValue(null as never);
      mockSave.mockResolvedValue(savedEntry);

      const result = await service.create(entryData);

      expect(result).toBeDefined();
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
      expect(mockSave).toHaveBeenCalled();
    });

    it('should throw BusinessError when alias already exists', async () => {
      const entryData = {
        name: 'Test Entry',
        alias: 'existing-alias',
      };

      vi.mocked(Entry.findOne).mockResolvedValue({
        _id: 'existing-id',
        alias: 'existing-alias',
      } as never);

      await expect(service.create(entryData)).rejects.toThrow(BusinessError);
      await expect(service.create(entryData)).rejects.toThrow('alias already exists');
    });

    it('should allow null/undefined alias', async () => {
      const entryData = {
        name: 'Test Entry',
      };

      const savedEntry = {
        _id: 'entry-id-1',
        ...entryData,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      mockSave.mockResolvedValue(savedEntry);

      const result = await service.create(entryData);

      expect(result).toBeDefined();
      expect(mockSave).toHaveBeenCalled();
    });

    it('should unset existing default when creating new default entry', async () => {
      const entryData = {
        name: 'Default Entry',
        isDefault: true,
      };

      vi.mocked(Entry.updateMany).mockResolvedValue({ modifiedCount: 1 } as never);
      mockSave.mockResolvedValue({
        _id: 'entry-id-1',
        ...entryData,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      await service.create(entryData);

      expect(Entry.updateMany).toHaveBeenCalledWith(
        { isDefault: true, isInvalid: false },
        { isDefault: false, updatedAt: expect.any(Number) }
      );
      expect(mockSave).toHaveBeenCalled();
    });
  });

  describe('getById', () => {
    it('should return an entry by id excluding soft-deleted', async () => {
      const mockEntry = {
        _id: 'entry-id-1',
        name: 'Test Entry',
        isInvalid: false,
      };

      vi.mocked(Entry.findOne).mockResolvedValue(mockEntry as never);

      const result = await service.getById('entry-id-1');

      expect(Entry.findOne).toHaveBeenCalledWith({
        alias: 'entry-id-1',
        isInvalid: { $ne: true },
      });
      expect(result).toEqual(mockEntry);
    });

    it('should query by _id for valid ObjectId strings', async () => {
      const mockEntry = {
        _id: '507f1f77bcf86cd799439011',
        name: 'Test Entry',
        isInvalid: false,
      };

      vi.mocked(Entry.findOne).mockResolvedValue(mockEntry as never);

      const result = await service.getById('507f1f77bcf86cd799439011');

      expect(Entry.findOne).toHaveBeenCalledWith({
        _id: '507f1f77bcf86cd799439011',
        isInvalid: { $ne: true },
      });
      expect(result).toEqual(mockEntry);
    });

    it('should return null for non-existent entry', async () => {
      vi.mocked(Entry.findOne).mockResolvedValue(null as never);

      const result = await service.getById('non-existent-id');

      expect(result).toBeNull();
    });
  });

  describe('getDefault', () => {
    it('should return the default entry', async () => {
      const mockEntry = {
        _id: 'default-entry-id',
        name: 'Default Entry',
        isDefault: true,
      };

      vi.mocked(Entry.findOne).mockResolvedValue(mockEntry as never);

      const result = await service.getDefault();

      expect(Entry.findOne).toHaveBeenCalledWith({
        isDefault: true,
        isInvalid: { $ne: true },
      });
      expect(result).toEqual(mockEntry);
    });

    it('should return null if no default entry exists', async () => {
      vi.mocked(Entry.findOne).mockResolvedValue(null as never);

      const result = await service.getDefault();

      expect(result).toBeNull();
    });
  });

  describe('list', () => {
    it('should return all entries without pagination', async () => {
      const mockEntries = [
        { _id: '1', name: 'Entry 1', createdAt: Date.now() },
        { _id: '2', name: 'Entry 2', createdAt: Date.now() },
      ];

      const mockSort = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue(mockEntries),
      });
      vi.mocked(Entry.find).mockReturnValue({ sort: mockSort } as never);

      const result = await service.list();

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('should return paginated results', async () => {
      const mockEntries = [{ _id: '1', name: 'Entry 1' }];

      const mockSort = vi.fn().mockReturnValue({
        skip: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            exec: vi.fn().mockResolvedValue(mockEntries),
          }),
        }),
      });
      vi.mocked(Entry.find).mockReturnValue({ sort: mockSort } as never);
      vi.mocked(Entry.countDocuments).mockResolvedValue(10 as never);

      const result = await service.list({}, 5, 0);

      expect(result.total).toBe(10);
      expect(result.limit).toBe(5);
      expect(result.offset).toBe(0);
    });

    it('should exclude soft-deleted entries', async () => {
      const mockEntries = [{ _id: '1', name: 'Entry 1' }];
      const mockSort = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue(mockEntries),
      });
      vi.mocked(Entry.find).mockReturnValue({ sort: mockSort } as never);

      await service.list();

      const filterArg = vi.mocked(Entry.find).mock.calls[0][0];
      expect(filterArg).toHaveProperty('isInvalid', { $ne: true });
    });
  });

  describe('update', () => {
    it('should update an entry successfully', async () => {
      const existingEntry = {
        _id: 'entry-id-1',
        name: 'Old Name',
        alias: 'old-alias',
        isInvalid: false,
      };

      const updatedEntry = {
        _id: 'entry-id-1',
        name: 'New Name',
        alias: 'old-alias',
        updatedAt: Date.now(),
      };

      vi.mocked(Entry.findOne).mockResolvedValue(existingEntry as never);
      vi.mocked(Entry.findByIdAndUpdate).mockResolvedValue(updatedEntry as never);

      const result = await service.update('entry-id-1', { name: 'New Name' });

      expect(result).toEqual(updatedEntry);
    });

    it('should return null for non-existent entry', async () => {
      vi.mocked(Entry.findOne).mockResolvedValue(null as never);

      const result = await service.update('non-existent-id', { name: 'New Name' });

      expect(result).toBeNull();
    });

    it('should throw BusinessError when updating to an existing alias', async () => {
      const existingEntry = {
        _id: 'entry-id-1',
        name: 'Entry 1',
        alias: 'old-alias',
        isInvalid: false,
      };

      vi.mocked(Entry.findOne)
        .mockResolvedValueOnce(existingEntry as never) // First call for checking existence
        .mockResolvedValueOnce({ _id: 'other-id', alias: 'new-alias' } as never); // Second call for alias check

      await expect(service.update('entry-id-1', { alias: 'new-alias' })).rejects.toThrow(BusinessError);
    });

    it('should allow updating alias to same value', async () => {
      const existingEntry = {
        _id: 'entry-id-1',
        name: 'Entry 1',
        alias: 'same-alias',
        isInvalid: false,
      };

      vi.mocked(Entry.findOne).mockResolvedValue(existingEntry as never);
      vi.mocked(Entry.findByIdAndUpdate).mockResolvedValue({
        ...existingEntry,
        updatedAt: Date.now(),
      } as never);

      const result = await service.update('entry-id-1', { alias: 'same-alias' });

      expect(result).toBeDefined();
    });

    it('should unset existing default when setting isDefault to true', async () => {
      const existingEntry = {
        _id: 'entry-id-1',
        name: 'Entry 1',
        isDefault: false,
        isInvalid: false,
      };

      vi.mocked(Entry.findOne).mockResolvedValue(existingEntry as never);
      vi.mocked(Entry.updateMany).mockResolvedValue({ modifiedCount: 1 } as never);
      vi.mocked(Entry.findByIdAndUpdate).mockResolvedValue({
        ...existingEntry,
        isDefault: true,
        updatedAt: Date.now(),
      } as never);

      await service.update('entry-id-1', { isDefault: true });

      expect(Entry.updateMany).toHaveBeenCalledWith(
        { _id: { $ne: 'entry-id-1' }, isDefault: true, isInvalid: false },
        { isDefault: false, updatedAt: expect.any(Number) }
      );
    });

    it('should remove server-controlled fields from input', async () => {
      const existingEntry = {
        _id: 'entry-id-1',
        name: 'Entry 1',
        isInvalid: false,
      };

      vi.mocked(Entry.findOne).mockResolvedValue(existingEntry as never);
      vi.mocked(Entry.findByIdAndUpdate).mockResolvedValue({} as never);

      await service.update('entry-id-1', {
        name: 'New Name',
        createdAt: 123456,
        updatedAt: 123456,
        invalidatedAt: 123456,
      });

      const updateArg = vi.mocked(Entry.findByIdAndUpdate).mock.calls[0][1] as Record<string, unknown>;
      expect(updateArg).not.toHaveProperty('createdAt', 123456);
      expect(updateArg).not.toHaveProperty('invalidatedAt', 123456);
      expect(updateArg).toHaveProperty('updatedAt');
    });

    it('should update uploadConfig with maxFileSize', async () => {
      const existingEntry = {
        _id: 'entry-id-1',
        name: 'Entry 1',
        isInvalid: false,
      };

      const updatedEntry = {
        ...existingEntry,
        uploadConfig: {
          maxFileSize: 10485760,
        },
        updatedAt: Date.now(),
      };

      vi.mocked(Entry.findOne).mockResolvedValue(existingEntry as never);
      vi.mocked(Entry.findByIdAndUpdate).mockResolvedValue(updatedEntry as never);

      const result = await service.update('entry-id-1', {
        uploadConfig: { maxFileSize: 10485760 },
      });

      expect(result?.uploadConfig?.maxFileSize).toBe(10485760);
      const updateArg = vi.mocked(Entry.findByIdAndUpdate).mock.calls[0][1] as Record<string, unknown>;
      expect(updateArg.uploadConfig).toEqual({ maxFileSize: 10485760 });
    });

    it('should update uploadConfig with allowedMimeTypes', async () => {
      const existingEntry = {
        _id: 'entry-id-1',
        name: 'Entry 1',
        isInvalid: false,
      };

      const updatedEntry = {
        ...existingEntry,
        uploadConfig: {
          allowedMimeTypes: ['image/jpeg', 'image/png'],
        },
        updatedAt: Date.now(),
      };

      vi.mocked(Entry.findOne).mockResolvedValue(existingEntry as never);
      vi.mocked(Entry.findByIdAndUpdate).mockResolvedValue(updatedEntry as never);

      const result = await service.update('entry-id-1', {
        uploadConfig: { allowedMimeTypes: ['image/jpeg', 'image/png'] },
      });

      expect(result?.uploadConfig?.allowedMimeTypes).toEqual(['image/jpeg', 'image/png']);
    });

    it('should update uploadConfig with readOnly flag', async () => {
      const existingEntry = {
        _id: 'entry-id-1',
        name: 'Entry 1',
        isInvalid: false,
      };

      const updatedEntry = {
        ...existingEntry,
        uploadConfig: {
          readOnly: true,
        },
        updatedAt: Date.now(),
      };

      vi.mocked(Entry.findOne).mockResolvedValue(existingEntry as never);
      vi.mocked(Entry.findByIdAndUpdate).mockResolvedValue(updatedEntry as never);

      const result = await service.update('entry-id-1', {
        uploadConfig: { readOnly: true },
      });

      expect(result?.uploadConfig?.readOnly).toBe(true);
    });

    it('should update uploadConfig with complete configuration', async () => {
      const existingEntry = {
        _id: 'entry-id-1',
        name: 'Entry 1',
        isInvalid: false,
      };

      const updatedEntry = {
        ...existingEntry,
        uploadConfig: {
          maxFileSize: 20971520,
          allowedMimeTypes: ['image/*', 'application/pdf'],
          readOnly: true,
        },
        updatedAt: Date.now(),
      };

      vi.mocked(Entry.findOne).mockResolvedValue(existingEntry as never);
      vi.mocked(Entry.findByIdAndUpdate).mockResolvedValue(updatedEntry as never);

      const result = await service.update('entry-id-1', {
        uploadConfig: {
          maxFileSize: 20971520,
          allowedMimeTypes: ['image/*', 'application/pdf'],
          readOnly: true,
        },
      });

      expect(result?.uploadConfig).toEqual({
        maxFileSize: 20971520,
        allowedMimeTypes: ['image/*', 'application/pdf'],
        readOnly: true,
      });
    });

    it('should update isDefault and uploadConfig together', async () => {
      const existingEntry = {
        _id: 'entry-id-1',
        name: 'Entry 1',
        isDefault: false,
        isInvalid: false,
      };

      const updatedEntry = {
        ...existingEntry,
        isDefault: true,
        uploadConfig: {
          maxFileSize: 5242880,
        },
        updatedAt: Date.now(),
      };

      vi.mocked(Entry.findOne).mockResolvedValue(existingEntry as never);
      vi.mocked(Entry.updateMany).mockResolvedValue({ modifiedCount: 1 } as never);
      vi.mocked(Entry.findByIdAndUpdate).mockResolvedValue(updatedEntry as never);

      const result = await service.update('entry-id-1', {
        isDefault: true,
        uploadConfig: { maxFileSize: 5242880 },
      });

      expect(result?.isDefault).toBe(true);
      expect(result?.uploadConfig?.maxFileSize).toBe(5242880);
      expect(Entry.updateMany).toHaveBeenCalledWith(
        { _id: { $ne: 'entry-id-1' }, isDefault: true, isInvalid: false },
        { isDefault: false, updatedAt: expect.any(Number) }
      );
    });

    it('should update name, alias, and uploadConfig together', async () => {
      const existingEntry = {
        _id: 'entry-id-1',
        name: 'Old Name',
        alias: 'old-alias',
        isInvalid: false,
      };

      const updatedEntry = {
        _id: 'entry-id-1',
        name: 'New Name',
        alias: 'new-alias',
        uploadConfig: {
          maxFileSize: 10485760,
          allowedMimeTypes: ['image/jpeg'],
        },
        updatedAt: Date.now(),
      };

      vi.mocked(Entry.findOne)
        .mockResolvedValueOnce(existingEntry as never)
        .mockResolvedValueOnce(null as never); // No duplicate alias
      vi.mocked(Entry.findByIdAndUpdate).mockResolvedValue(updatedEntry as never);

      const result = await service.update('entry-id-1', {
        name: 'New Name',
        alias: 'new-alias',
        uploadConfig: {
          maxFileSize: 10485760,
          allowedMimeTypes: ['image/jpeg'],
        },
      });

      expect(result?.name).toBe('New Name');
      expect(result?.alias).toBe('new-alias');
      expect(result?.uploadConfig?.maxFileSize).toBe(10485760);
    });
  });

  describe('delete', () => {
    it('should perform soft delete with timestamps', async () => {
      const existingEntry = {
        _id: 'entry-id-1',
        name: 'Test Entry',
        isInvalid: false,
      };

      const deletedEntry = {
        ...existingEntry,
        isInvalid: true,
        invalidatedAt: Date.now(),
        updatedAt: Date.now(),
      };

      const associatedResources: any[] = [];

      vi.mocked(Entry.findOne).mockResolvedValue(existingEntry as never);
      vi.mocked(Resource.find).mockResolvedValue(associatedResources as never);
      vi.mocked(Block.find).mockResolvedValue([] as never);
      vi.mocked(Entry.findByIdAndUpdate).mockResolvedValue(deletedEntry as never);

      const result = await service.delete('entry-id-1');

      expect(Entry.findOne).toHaveBeenCalledWith({ _id: 'entry-id-1', isInvalid: { $ne: true } });
      // Entry soft-delete should still use findByIdAndUpdate
      expect(Entry.findByIdAndUpdate).toHaveBeenCalledWith(
        'entry-id-1',
        expect.objectContaining({
          isInvalid: true,
          invalidatedAt: expect.any(Number),
          updatedAt: expect.any(Number),
        }),
        expect.any(Object)
      );
      expect(result?.isInvalid).toBe(true);
    });

    it('should return null for non-existent entry', async () => {
      vi.mocked(Entry.findOne).mockResolvedValue(null as never);

      const result = await service.delete('non-existent-id');

      expect(result).toBeNull();
    });

    it('should return null for already soft-deleted entry', async () => {
      vi.mocked(Entry.findOne).mockResolvedValue(null as never);

      const result = await service.delete('soft-deleted-id');

      expect(result).toBeNull();
    });
  });
});

describe('entryService singleton', () => {
  it('should be an instance of EntryService', () => {
    expect(entryService).toBeInstanceOf(EntryService);
  });
});

describe('BusinessError', () => {
  it('should create error with message and status code', () => {
    const error = new BusinessError('Test error', 409);
    expect(error.message).toBe('Test error');
    expect(error.statusCode).toBe(409);
    expect(error.name).toBe('BusinessError');
  });
});
