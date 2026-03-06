/**
 * Pagination utilities for validating and normalizing pagination parameters
 * Following the data boundaries rule: limit (1-200, default 50), offset (0-100000, default 0)
 */

export interface PaginationParams {
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface ValidatedPagination {
  limit: number;
  offset: number;
}

// Shared constants
const DEFAULT_LIMIT = 50;
const MIN_LIMIT = 1;
const DEFAULT_MAX_LIMIT = 200;
const MAX_OFFSET = 100_000;

/**
 * Validate and clamp an offset value.
 */
function clampOffset(raw?: number): number {
  if (typeof raw === 'number' && !isNaN(raw)) {
    return Math.max(0, Math.min(MAX_OFFSET, Math.floor(raw)));
  }
  return 0;
}

/**
 * Validate and clamp a limit value within [MIN_LIMIT, maxLimit].
 */
function clampLimit(raw: number | undefined, maxLimit: number, defaultVal: number): number {
  if (typeof raw === 'number' && !isNaN(raw)) {
    return Math.max(MIN_LIMIT, Math.min(maxLimit, Math.floor(raw)));
  }
  return defaultVal;
}

/**
 * Validates and normalizes pagination parameters according to system boundaries
 * 
 * Constraints:
 * - limit: 1-200 (default: 50)
 * - offset: 0-100000 (default: 0)
 * 
 * @param params - Raw pagination parameters
 * @returns Normalized pagination parameters within valid bounds
 */
export function validatePagination(params?: PaginationParams): ValidatedPagination {
  return {
    limit: clampLimit(params?.limit, DEFAULT_MAX_LIMIT, DEFAULT_LIMIT),
    offset: clampOffset(params?.offset),
  };
}

/**
 * Validates pagination with custom max limit (for special cases like log queries)
 *
 * @param params - Raw pagination parameters
 * @param maxLimit - Custom maximum limit (e.g., 500 for logs)
 * @returns Normalized pagination parameters
 */
export function validatePaginationWithMaxLimit(
  params?: PaginationParams,
  maxLimit: number = DEFAULT_MAX_LIMIT,
): ValidatedPagination {
  return {
    limit: clampLimit(params?.limit, maxLimit, DEFAULT_LIMIT),
    offset: clampOffset(params?.offset),
  };
}

/**
 * Validates pagination with optional limit support
 * When limit is not provided, it remains undefined (no limit applied)
 *
 * @param params - Raw pagination parameters
 * @returns Normalized pagination parameters with optional limit
 */
export function validatePaginationOptionalLimit(params?: PaginationParams): {
  limit?: number | undefined;
  offset: number;
} {
  const raw = params?.limit;
  const limit = typeof raw === 'number' && !isNaN(raw)
    ? Math.max(MIN_LIMIT, Math.min(DEFAULT_MAX_LIMIT, Math.floor(raw)))
    : undefined;

  return { limit, offset: clampOffset(params?.offset) };
}
