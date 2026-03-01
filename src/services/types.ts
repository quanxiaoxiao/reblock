// Shared pagination types for services

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  limit?: number;
  offset?: number;
}
