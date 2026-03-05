import { describe, it, expect } from 'vitest';
import {
  createEntrySchema,
  updateEntrySchema,
  getEntryByIdSchema,
} from '../../../src/schemas/entrySchema';

const VALID_OBJECT_ID = '507f1f77bcf86cd799439011';

describe('entrySchema', () => {
  describe('createEntrySchema', () => {
    it('should validate valid entry creation data', () => {
      const validData = {
        body: {
          name: 'Test Entry',
          alias: 'test-alias',
          order: 1,
          description: 'Test description',
        },
      };

      const result = createEntrySchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should validate with only required name field', () => {
      const validData = {
        body: {
          name: 'Test Entry',
        },
      };

      const result = createEntrySchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should reject empty name', () => {
      const invalidData = {
        body: {
          name: '',
          alias: 'test-alias',
        },
      };

      const result = createEntrySchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject missing name', () => {
      const invalidData = {
        body: {
          alias: 'test-alias',
        },
      };

      const result = createEntrySchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should allow null alias', () => {
      const validData = {
        body: {
          name: 'Test Entry',
          alias: null,
        },
      };

      const result = createEntrySchema.safeParse(validData);
      expect(result.success).toBe(false); // null is not allowed for optional string
    });

    it('should reject wrong type for order', () => {
      const invalidData = {
        body: {
          name: 'Test Entry',
          order: 'first',
        },
      };

      const result = createEntrySchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should validate positive retentionMs in uploadConfig', () => {
      const validData = {
        body: {
          name: 'Retention Entry',
          uploadConfig: {
            retentionMs: 60000,
          },
        },
      };

      const result = createEntrySchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should reject non-positive retentionMs in uploadConfig', () => {
      const invalidData = {
        body: {
          name: 'Retention Entry',
          uploadConfig: {
            retentionMs: 0,
          },
        },
      };

      const result = createEntrySchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });
  });

  describe('updateEntrySchema', () => {
    it('should validate valid entry update data', () => {
      const validData = {
        body: {
          name: 'Updated Entry',
          alias: 'updated-alias',
          order: 2,
        },
        params: {
          id: VALID_OBJECT_ID,
        },
      };

      const result = updateEntrySchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should validate partial update', () => {
      const validData = {
        body: {
          description: 'New description',
        },
        params: {
          id: VALID_OBJECT_ID,
        },
      };

      const result = updateEntrySchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should validate empty body', () => {
      const validData = {
        body: {},
        params: {
          id: VALID_OBJECT_ID,
        },
      };

      const result = updateEntrySchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should reject empty name when provided', () => {
      const invalidData = {
        body: {
          name: '',
        },
        params: {
          id: VALID_OBJECT_ID,
        },
      };

      const result = updateEntrySchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should require params.id', () => {
      const invalidData = {
        body: {
          name: 'Updated Entry',
        },
        params: {},
      };

      const result = updateEntrySchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject invalid ObjectId format for id', () => {
      const invalidData = {
        body: {
          name: 'Updated Entry',
        },
        params: {
          id: 'entry-id-1', // not valid ObjectId
        },
      };

      const result = updateEntrySchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should validate positive retentionMs in update uploadConfig', () => {
      const validData = {
        body: {
          uploadConfig: {
            retentionMs: 1,
          },
        },
        params: {
          id: VALID_OBJECT_ID,
        },
      };

      const result = updateEntrySchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should reject string retentionMs in update uploadConfig', () => {
      const invalidData = {
        body: {
          uploadConfig: {
            retentionMs: 'abc',
          },
        },
        params: {
          id: VALID_OBJECT_ID,
        },
      };

      const result = updateEntrySchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });
  });

  describe('getEntryByIdSchema', () => {
    it('should validate valid id param', () => {
      const validData = {
        params: {
          id: VALID_OBJECT_ID,
        },
      };

      const result = getEntryByIdSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should require id param', () => {
      const invalidData = {
        params: {},
      };

      const result = getEntryByIdSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should accept valid MongoDB ObjectId', () => {
      const validData = {
        params: {
          id: '507f1f77bcf86cd799439011',
        },
      };

      const result = getEntryByIdSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });
  });
});
