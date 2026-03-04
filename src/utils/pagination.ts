/**
 * Pagination utilities for validating and normalizing pagination parameters
 * Following the data boundaries rule: limit (1-200, default 50), offset (0-100000, default 0)
 */

export interface PaginationParams {
  limit?: number;
  offset?: number;
}

export interface ValidatedPagination {
  limit: number;
  offset: number;
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
  const rawLimit = params?.limit;
  const rawOffset = params?.offset;

  // Validate limit: must be number, within 1-200, default 50
  let limit: number;
  if (typeof rawLimit === 'number' && !isNaN(rawLimit)) {
    limit = Math.max(1, Math.min(200, Math.floor(rawLimit)));
  } else {
    limit = 50;
  }

  // Validate offset: must be number, within 0-100000, default 0
  let offset: number;
  if (typeof rawOffset === 'number' && !isNaN(rawOffset)) {
    offset = Math.max(0, Math.min(100000, Math.floor(rawOffset)));
  } else {
    offset = 0;
  }

  return { limit, offset };
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
  maxLimit: number = 200
): ValidatedPagination {
  const rawLimit = params?.limit;
  const rawOffset = params?.offset;

  // Validate limit with custom max
  let limit: number;
  if (typeof rawLimit === 'number' && !isNaN(rawLimit)) {
    limit = Math.max(1, Math.min(maxLimit, Math.floor(rawLimit)));
  } else {
    limit = 50;
  }

  // Validate offset: must be number, within 0-100000, default 0
  let offset: number;
  if (typeof rawOffset === 'number' && !isNaN(rawOffset)) {
    offset = Math.max(0, Math.min(100000, Math.floor(rawOffset)));
  } else {
    offset = 0;
  }

  return { limit, offset };
}

/**
 * Validates pagination with optional limit support
 * When limit is not provided, it remains undefined (no limit applied)
 *
 * @param params - Raw pagination parameters
 * @returns Normalized pagination parameters with optional limit
 */
export function validatePaginationOptionalLimit(params?: PaginationParams): {
  limit?: number;
  offset: number;
} {
  const rawLimit = params?.limit;
  const rawOffset = params?.offset;

  // Validate limit: must be number, within 1-200, otherwise undefined
  let limit: number | undefined;
  if (typeof rawLimit === 'number' && !isNaN(rawLimit)) {
    limit = Math.max(1, Math.min(200, Math.floor(rawLimit)));
  }

  // Validate offset: must be number, within 0-100000, default 0
  let offset: number;
  if (typeof rawOffset === 'number' && !isNaN(rawOffset)) {
    offset = Math.max(0, Math.min(100000, Math.floor(rawOffset)));
  } else {
    offset = 0;
  }

  return { limit, offset };
}
