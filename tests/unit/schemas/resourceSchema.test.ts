import { describe, it, expect } from 'vitest';
import {
  createResourceSchema,
  updateResourceSchema,
  getResourceByIdSchema,
} from '../../../src/schemas/resourceSchema';

const VALID_OBJECT_ID = '507f1f77bcf86cd799439011';
const VALID_BLOCK_ID = '507f1f77bcf86cd799439012';
const VALID_ENTRY_ID = '507f1f77bcf86cd799439013';

describe('resourceSchema', () => {
  describe('createResourceSchema', () => {
    it('should validate valid resource creation data', () => {
      const validData = {
        body: {
          block: VALID_BLOCK_ID,
          entry: VALID_ENTRY_ID,
          mime: 'text/plain',
          category: 'documents',
          description: 'Test resource',
          name: 'test.txt',
        },
      };

      const result = createResourceSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should validate with only required fields', () => {
      const validData = {
        body: {
          block: VALID_BLOCK_ID,
          entry: VALID_ENTRY_ID,
        },
      };

      const result = createResourceSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should require block field', () => {
      const invalidData = {
        body: {
          entry: VALID_ENTRY_ID,
        },
      };

      const result = createResourceSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should require entry field', () => {
      const invalidData = {
        body: {
          block: VALID_BLOCK_ID,
        },
      };

      const result = createResourceSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject empty block', () => {
      const invalidData = {
        body: {
          block: '',
          entry: VALID_ENTRY_ID,
        },
      };

      const result = createResourceSchema.safeParse(invalidData);
      // Empty string does not match ObjectId regex
      expect(result.success).toBe(false);
    });

    it('should reject invalid ObjectId format for block', () => {
      const invalidData = {
        body: {
          block: 'not-an-objectid',
          entry: VALID_ENTRY_ID,
        },
      };

      const result = createResourceSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should accept various mime types', () => {
      const mimeTypes = [
        'text/plain',
        'image/png',
        'application/json',
        'application/pdf',
      ];

      mimeTypes.forEach((mime) => {
        const validData = {
          body: {
            block: VALID_BLOCK_ID,
            entry: VALID_ENTRY_ID,
            mime,
          },
        };

        const result = createResourceSchema.safeParse(validData);
        expect(result.success).toBe(true);
      });
    });
  });

  describe('updateResourceSchema', () => {
    it('should validate valid resource update data', () => {
      const validData = {
        body: {
          mime: 'image/jpeg',
          name: 'updated.jpg',
        },
        params: {
          id: VALID_OBJECT_ID,
        },
      };

      const result = updateResourceSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should validate partial update', () => {
      const validData = {
        body: {
          description: 'Updated description',
        },
        params: {
          id: VALID_OBJECT_ID,
        },
      };

      const result = updateResourceSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should validate empty body', () => {
      const validData = {
        body: {},
        params: {
          id: VALID_OBJECT_ID,
        },
      };

      const result = updateResourceSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should require params.id', () => {
      const invalidData = {
        body: {
          name: 'Updated Resource',
        },
        params: {},
      };

      const result = updateResourceSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should accept string fields for metadata update', () => {
      const validData = {
        body: {
          mime: 'application/octet-stream',
          category: 'other',
          description: '',
          name: '',
        },
        params: {
          id: VALID_OBJECT_ID,
        },
      };

      const result = updateResourceSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should not include block or entry in update body', () => {
      // block and entry are excluded from updates — use PATCH /:id/block instead
      const data = {
        body: {
          block: VALID_BLOCK_ID,
          entry: VALID_ENTRY_ID,
        },
        params: {
          id: VALID_OBJECT_ID,
        },
      };

      const result = updateResourceSchema.safeParse(data);
      // Zod strips unknown keys, so it passes but block/entry are removed
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.body).not.toHaveProperty('block');
        expect(result.data.body).not.toHaveProperty('entry');
      }
    });
  });

  describe('getResourceByIdSchema', () => {
    it('should validate valid id param', () => {
      const validData = {
        params: {
          id: VALID_OBJECT_ID,
        },
      };

      const result = getResourceByIdSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should require id param', () => {
      const invalidData = {
        params: {},
      };

      const result = getResourceByIdSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should accept MongoDB ObjectId format', () => {
      const validData = {
        params: {
          id: '507f1f77bcf86cd799439011',
        },
      };

      const result = getResourceByIdSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should reject non-string id', () => {
      const invalidData = {
        params: {
          id: 12345,
        },
      };

      const result = getResourceByIdSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });
  });
});
