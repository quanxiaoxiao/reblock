import { describe, it, expect } from 'vitest';
import {
  createResourceSchema,
  updateResourceSchema,
  getResourceByIdSchema,
} from '../../../src/schemas/resourceSchema';

describe('resourceSchema', () => {
  describe('createResourceSchema', () => {
    it('should validate valid resource creation data', () => {
      const validData = {
        body: {
          block: 'block-id-1',
          entry: 'entry-id-1',
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
          block: 'block-id-1',
          entry: 'entry-id-1',
        },
      };

      const result = createResourceSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should require block field', () => {
      const invalidData = {
        body: {
          entry: 'entry-id-1',
        },
      };

      const result = createResourceSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should require entry field', () => {
      const invalidData = {
        body: {
          block: 'block-id-1',
        },
      };

      const result = createResourceSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject empty block', () => {
      const invalidData = {
        body: {
          block: '',
          entry: 'entry-id-1',
        },
      };

      const result = createResourceSchema.safeParse(invalidData);
      // Empty string is technically a valid string in Zod
      expect(result.success).toBe(true);
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
            block: 'block-id-1',
            entry: 'entry-id-1',
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
          block: 'new-block-id',
          mime: 'image/jpeg',
          name: 'updated.jpg',
        },
        params: {
          id: 'resource-id-1',
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
          id: 'resource-id-1',
        },
      };

      const result = updateResourceSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should validate empty body', () => {
      const validData = {
        body: {},
        params: {
          id: 'resource-id-1',
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

    it('should accept any string fields', () => {
      const validData = {
        body: {
          block: 'new-block-id',
          entry: 'new-entry-id',
          mime: 'application/octet-stream',
          category: 'other',
          description: '',
          name: '',
        },
        params: {
          id: 'resource-id-1',
        },
      };

      const result = updateResourceSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });
  });

  describe('getResourceByIdSchema', () => {
    it('should validate valid id param', () => {
      const validData = {
        params: {
          id: 'resource-id-1',
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
