import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Types } from 'mongoose';
import { MigrationService, MigrationError } from '../../../src/services/migrationService';
import { Entry } from '../../../src/models';

// Mock the models
vi.mock('../../../src/models', () => ({
  Resource: {
    findById: vi.fn(),
    findOne: vi.fn(),
  },
  Block: {
    findById: vi.fn(),
    findOneAndUpdate: vi.fn(),
    create: vi.fn(),
    syncIndexes: vi.fn(),
  },
  Entry: {
    findOne: vi.fn(),
  },
}));

describe('MigrationService', () => {
  let migrationService: MigrationService;

  beforeEach(() => {
    migrationService = new MigrationService();
    vi.clearAllMocks();
  });

  describe('importResource validation', () => {
    const validLegacyId = '6906d8085481cd13472265cd';
    const validEntryAlias = 'test-entry';

    it('should throw error for invalid legacyId format', async () => {
      await expect(
        migrationService.importResource({
          legacyId: 'invalid-id',
          entryAlias: validEntryAlias,
          name: 'test.txt',
          contentBase64: 'dGVzdA==',
        })
      ).rejects.toThrow(MigrationError);
    });

    it('should throw 404 error when entry not found', async () => {
      vi.mocked(Entry.findOne).mockResolvedValue(null as any);

      await expect(
        migrationService.importResource({
          legacyId: validLegacyId,
          entryAlias: 'non-existent-entry',
          name: 'test.txt',
          contentBase64: 'dGVzdA==',
        })
      ).rejects.toThrow('Entry not found');
    });



    it('should throw error when file size exceeds limit', async () => {
      const mockEntry = {
        _id: new Types.ObjectId(),
        alias: validEntryAlias,
        uploadConfig: { maxFileSize: 1 }, // 1 byte limit
      };
      vi.mocked(Entry.findOne).mockResolvedValue(mockEntry as any);

      // 'dGVzdA==' is 'test' (4 bytes)
      await expect(
        migrationService.importResource({
          legacyId: validLegacyId,
          entryAlias: validEntryAlias,
          name: 'test.txt',
          contentBase64: 'dGVzdA==',
        })
      ).rejects.toThrow('exceeds limit');
    });
  });

  describe('validateEntry', () => {
    it('should return entry when found', async () => {
      const mockEntry = {
        _id: new Types.ObjectId(),
        alias: 'test-entry',
      };

      vi.mocked(Entry.findOne).mockResolvedValue(mockEntry as any);

      // Access private method via any
      const result = await (migrationService as any).validateEntry('test-entry');
      expect(result).toEqual(mockEntry);
    });

    it('should throw error when entry not found', async () => {
      vi.mocked(Entry.findOne).mockResolvedValue(null);

      await expect(
        (migrationService as any).validateEntry('non-existent')
      ).rejects.toThrow(MigrationError);
    });
  });

  describe('validateFileSize', () => {
    it('should not throw when size is within limit', () => {
      expect(() => {
        (migrationService as any).validateFileSize(1000, { maxFileSize: 10000 });
      }).not.toThrow();
    });

    it('should throw when size exceeds limit', () => {
      expect(() => {
        (migrationService as any).validateFileSize(10000, { maxFileSize: 1000 });
      }).toThrow(MigrationError);
    });

    it('should not throw when no maxFileSize configured', () => {
      expect(() => {
        (migrationService as any).validateFileSize(1000000, undefined);
      }).not.toThrow();
    });
  });

  describe('decodeBase64ToTemp', () => {
    it('should successfully decode valid base64', async () => {
      const result = await (migrationService as any).decodeBase64ToTemp('dGVzdA==');
      expect(result).toContain('migration-');
      expect(result).toContain('storage/_temp');
    });
  });

  describe('computeSHA256', () => {
    it('should compute correct SHA256 hash', async () => {
      // Create a temp file with known content
      const tempPath = await (migrationService as any).decodeBase64ToTemp('dGVzdA==');
      
      try {
        const hash = await (migrationService as any).computeSHA256(tempPath);
        // SHA256 of 'test' is: 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
        expect(hash).toBe('9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08');
      } finally {
        // Cleanup
        const fs = await import('fs/promises');
        await fs.unlink(tempPath).catch(() => {});
      }
    });
  });
});
