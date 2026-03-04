import { describe, it, expect } from 'vitest';
import {
  validatePagination,
  validatePaginationWithMaxLimit,
  validatePaginationOptionalLimit,
  PaginationParams,
} from '@/utils/pagination';

describe('pagination utils', () => {
  describe('validatePagination', () => {
    it('should use defaults when no params provided', () => {
      const result = validatePagination();

      expect(result).toEqual({ limit: 50, offset: 0 });
    });

    it('should use provided valid values', () => {
      const params: PaginationParams = { limit: 100, offset: 50 };
      const result = validatePagination(params);

      expect(result).toEqual({ limit: 100, offset: 50 });
    });

    it('should enforce minimum limit of 1', () => {
      const result = validatePagination({ limit: 0 });

      expect(result.limit).toBe(1);
    });

    it('should enforce maximum limit of 200', () => {
      const result = validatePagination({ limit: 500 });

      expect(result.limit).toBe(200);
    });

    it('should enforce minimum offset of 0', () => {
      const result = validatePagination({ offset: -10 });

      expect(result.offset).toBe(0);
    });

    it('should enforce maximum offset of 100000', () => {
      const result = validatePagination({ offset: 999999 });

      expect(result.offset).toBe(100000);
    });

    it('should floor float limit values', () => {
      const result = validatePagination({ limit: 75.9 });

      expect(result.limit).toBe(75);
    });

    it('should floor float offset values', () => {
      const result = validatePagination({ offset: 123.7 });

      expect(result.offset).toBe(123);
    });

    it('should handle NaN limit by using default', () => {
      const result = validatePagination({ limit: NaN });

      expect(result.limit).toBe(50);
    });

    it('should handle NaN offset by using default', () => {
      const result = validatePagination({ offset: NaN });

      expect(result.offset).toBe(0);
    });

    it('should ignore non-number limit', () => {
      const result = validatePagination({ limit: '100' as any });

      expect(result.limit).toBe(50);
    });

    it('should ignore non-number offset', () => {
      const result = validatePagination({ offset: '50' as any });

      expect(result.offset).toBe(0);
    });

    it('should handle negative float limit', () => {
      const result = validatePagination({ limit: -5.5 });

      expect(result.limit).toBe(1);
    });

    it('should handle partial params', () => {
      const result = validatePagination({ limit: 25 });

      expect(result.limit).toBe(25);
      expect(result.offset).toBe(0);
    });
  });

  describe('validatePaginationWithMaxLimit', () => {
    it('should use custom max limit', () => {
      const result = validatePaginationWithMaxLimit({ limit: 500 }, 1000);

      expect(result.limit).toBe(500);
    });

    it('should enforce custom max limit', () => {
      const result = validatePaginationWithMaxLimit({ limit: 1000 }, 500);

      expect(result.limit).toBe(500);
    });

    it('should use default max limit of 200 when not specified', () => {
      const result = validatePaginationWithMaxLimit({ limit: 300 });

      expect(result.limit).toBe(200);
    });

    it('should respect other constraints', () => {
      const result = validatePaginationWithMaxLimit(
        { limit: 50, offset: 100 },
        500
      );

      expect(result).toEqual({ limit: 50, offset: 100 });
    });

    it('should handle large custom max for logs', () => {
      const result = validatePaginationWithMaxLimit({ limit: 1000 }, 2000);

      expect(result.limit).toBe(1000);
    });
  });

  describe('validatePaginationOptionalLimit', () => {
    it('should return undefined limit when not provided', () => {
      const result = validatePaginationOptionalLimit();

      expect(result.limit).toBeUndefined();
      expect(result.offset).toBe(0);
    });

    it('should return valid limit when provided', () => {
      const result = validatePaginationOptionalLimit({ limit: 100 });

      expect(result.limit).toBe(100);
    });

    it('should enforce limit bounds when provided', () => {
      const result = validatePaginationOptionalLimit({ limit: 500 });

      expect(result.limit).toBe(200);
    });

    it('should enforce minimum limit of 1', () => {
      const result = validatePaginationOptionalLimit({ limit: 0 });

      expect(result.limit).toBe(1);
    });

    it('should handle valid offset', () => {
      const result = validatePaginationOptionalLimit({ offset: 50 });

      expect(result.offset).toBe(50);
    });

    it('should handle offset without limit', () => {
      const result = validatePaginationOptionalLimit({ offset: 100 });

      expect(result.limit).toBeUndefined();
      expect(result.offset).toBe(100);
    });

    it('should use default offset when not provided', () => {
      const result = validatePaginationOptionalLimit({ limit: 25 });

      expect(result.offset).toBe(0);
    });

    it('should handle NaN limit as undefined', () => {
      const result = validatePaginationOptionalLimit({ limit: NaN });

      expect(result.limit).toBeUndefined();
    });

    it('should handle non-number limit as undefined', () => {
      const result = validatePaginationOptionalLimit({ limit: 'invalid' as any });

      expect(result.limit).toBeUndefined();
    });
  });

  describe('edge cases', () => {
    it('should handle Infinity limit', () => {
      const result = validatePagination({ limit: Infinity });

      expect(result.limit).toBe(200);
    });

    it('should handle Infinity offset', () => {
      const result = validatePagination({ offset: Infinity });

      expect(result.offset).toBe(100000);
    });

    it('should handle -Infinity limit', () => {
      const result = validatePagination({ limit: -Infinity });

      expect(result.limit).toBe(1);
    });

    it('should handle -Infinity offset', () => {
      const result = validatePagination({ offset: -Infinity });

      expect(result.offset).toBe(0);
    });

    it('should handle maximum valid values', () => {
      const result = validatePagination({ limit: 200, offset: 100000 });

      expect(result).toEqual({ limit: 200, offset: 100000 });
    });

    it('should handle minimum valid values', () => {
      const result = validatePagination({ limit: 1, offset: 0 });

      expect(result).toEqual({ limit: 1, offset: 0 });
    });
  });
});
