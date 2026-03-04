import { describe, it, expect } from 'vitest';
import {
  createBlockSchema,
  updateBlockSchema,
  getBlockByIdSchema,
} from '../../../src/schemas/blockSchema';

// Valid test fixtures matching new schema requirements
const VALID_SHA256 = 'a'.repeat(64); // 64-char lowercase hex
const VALID_OBJECT_ID = '507f1f77bcf86cd799439011'; // 24-char hex

describe('blockSchema', () => {
  describe('createBlockSchema', () => {
    it('should validate valid block creation data', () => {
      const validData = {
        body: {
          sha256: VALID_SHA256,
          linkCount: 1,
          size: 1024,
        },
      };

      const result = createBlockSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should validate without optional fields', () => {
      const validData = {
        body: {
          sha256: VALID_SHA256,
        },
      };

      const result = createBlockSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should reject empty sha256', () => {
      const invalidData = {
        body: {
          sha256: '',
          linkCount: 1,
        },
      };

      const result = createBlockSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject invalid sha256 format', () => {
      const invalidData = {
        body: {
          sha256: 'abc123', // too short
        },
      };

      const result = createBlockSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject missing sha256', () => {
      const invalidData = {
        body: {
          linkCount: 1,
        },
      };

      const result = createBlockSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject wrong types', () => {
      const invalidData = {
        body: {
          sha256: VALID_SHA256,
          linkCount: 'not a number',
        },
      };

      const result = createBlockSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject negative linkCount', () => {
      const invalidData = {
        body: {
          sha256: VALID_SHA256,
          linkCount: -1,
        },
      };

      const result = createBlockSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });
  });

  describe('updateBlockSchema', () => {
    it('should validate valid block update data', () => {
      const validData = {
        body: {
          linkCount: 2,
        },
        params: {
          id: VALID_OBJECT_ID,
        },
      };

      const result = updateBlockSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should validate partial update', () => {
      const validData = {
        body: {
          linkCount: 3,
        },
        params: {
          id: VALID_OBJECT_ID,
        },
      };

      const result = updateBlockSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should validate empty body (no fields to update)', () => {
      const validData = {
        body: {},
        params: {
          id: VALID_OBJECT_ID,
        },
      };

      const result = updateBlockSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should not accept sha256 in update body', () => {
      // sha256 is intentionally excluded from updates to protect content-addressable integrity
      const data = {
        body: {
          sha256: VALID_SHA256,
        },
        params: {
          id: VALID_OBJECT_ID,
        },
      };

      const result = updateBlockSchema.safeParse(data);
      // Zod strips unknown keys by default, so it passes but sha256 is removed
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.body).not.toHaveProperty('sha256');
      }
    });

    it('should require params.id', () => {
      const invalidData = {
        body: {
          linkCount: 1,
        },
        params: {},
      };

      const result = updateBlockSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject invalid ObjectId format for id', () => {
      const invalidData = {
        body: {},
        params: {
          id: 'block-id-1', // not a valid 24-char hex
        },
      };

      const result = updateBlockSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject wrong type for id', () => {
      const invalidData = {
        body: {},
        params: {
          id: 123,
        },
      };

      const result = updateBlockSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });
  });

  describe('getBlockByIdSchema', () => {
    it('should validate valid id param', () => {
      const validData = {
        params: {
          id: VALID_OBJECT_ID,
        },
      };

      const result = getBlockByIdSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should require id param', () => {
      const invalidData = {
        params: {},
      };

      const result = getBlockByIdSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject empty id', () => {
      const invalidData = {
        params: {
          id: '',
        },
      };

      const result = getBlockByIdSchema.safeParse(invalidData);
      expect(result.success).toBe(false); // Empty string doesn't match ObjectId regex
    });

    it('should reject non-string id', () => {
      const invalidData = {
        params: {
          id: 12345,
        },
      };

      const result = getBlockByIdSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });
  });
});
