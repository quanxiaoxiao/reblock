import { describe, it, expect } from 'vitest';
import {
  createResourceSchema,
  updateResourceSchema,
  getResourceByIdSchema,
  createResourceCategorySchema,
  updateResourceCategorySchema,
  getResourceCategoryByKeySchema,
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
          categoryKey: 'documents',
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
          categoryKey: 'other',
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

    it('should reject block in update body', () => {
      const data = {
        body: {
          block: VALID_BLOCK_ID,
        },
        params: {
          id: VALID_OBJECT_ID,
        },
      };

      const result = updateResourceSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should allow entry in update body', () => {
      const data = {
        body: {
          entry: VALID_ENTRY_ID,
        },
        params: {
          id: VALID_OBJECT_ID,
        },
      };

      const result = updateResourceSchema.safeParse(data);
      expect(result.success).toBe(true);
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

  describe('resource category schemas', () => {
    it('should validate category create payload', () => {
      const result = createResourceCategorySchema.safeParse({
        body: {
          name: 'Documents',
          iconDataUri: 'data:image/svg+xml;base64,PHN2Zy8+',
          color: '#AABBCC',
        },
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid color', () => {
      const result = createResourceCategorySchema.safeParse({
        body: {
          name: 'Documents',
          color: 'red',
        },
      });
      expect(result.success).toBe(false);
    });

    it('should validate update and key schema', () => {
      const updateResult = updateResourceCategorySchema.safeParse({
        params: { key: 'documents-1' },
        body: { name: 'Docs' },
      });
      expect(updateResult.success).toBe(true);

      const getResult = getResourceCategoryByKeySchema.safeParse({
        params: { key: 'documents-1' },
      });
      expect(getResult.success).toBe(true);
    });
  });
});
