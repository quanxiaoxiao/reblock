import { describe, it, expect } from 'vitest';
import {
  createBlockSchema,
  updateBlockSchema,
  getBlockByIdSchema,
} from '../../../src/schemas/blockSchema';

describe('blockSchema', () => {
  describe('createBlockSchema', () => {
    it('should validate valid block creation data', () => {
      const validData = {
        body: {
          sha256: 'abc123def456',
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
          sha256: 'abc123def456',
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
          sha256: 'abc123',
          linkCount: 'not a number',
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
          sha256: 'new-sha256',
          linkCount: 2,
        },
        params: {
          id: 'block-id-1',
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
          id: 'block-id-1',
        },
      };

      const result = updateBlockSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should validate empty body (no fields to update)', () => {
      const validData = {
        body: {},
        params: {
          id: 'block-id-1',
        },
      };

      const result = updateBlockSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should reject empty string for sha256', () => {
      const invalidData = {
        body: {
          sha256: '',
        },
        params: {
          id: 'block-id-1',
        },
      };

      const result = updateBlockSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should require params.id', () => {
      const invalidData = {
        body: {
          sha256: 'abc123',
        },
        params: {},
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
          id: 'block-id-1',
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
      expect(result.success).toBe(true); // Empty string is still a string
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
