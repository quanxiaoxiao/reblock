import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import resourceCategoryRouter from '../../../src/routes/resourceCategoryRouter';
import { resourceCategoryService, ResourceCategoryError } from '../../../src/services/resourceCategoryService';

vi.mock('../../../src/services/resourceCategoryService', () => ({
  resourceCategoryService: {
    create: vi.fn(),
    list: vi.fn(),
    getByKey: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  ResourceCategoryError: class ResourceCategoryError extends Error {
    statusCode: number;
    code?: string;
    constructor(message: string, statusCode: number, code?: string) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  },
}));

describe('resourceCategoryRouter', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.route('/resource-categories', resourceCategoryRouter);
    vi.clearAllMocks();
  });

  it('creates category', async () => {
    vi.mocked(resourceCategoryService.create).mockResolvedValue({
      _id: 'c1',
      key: 'documents',
      name: 'Documents',
    } as never);

    const res = await app.request('/resource-categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Documents' }),
    });

    expect(res.status).toBe(201);
    expect(resourceCategoryService.create).toHaveBeenCalledWith({ name: 'Documents' });
  });

  it('lists categories', async () => {
    vi.mocked(resourceCategoryService.list).mockResolvedValue([
      { _id: 'c1', key: 'documents', name: 'Documents' } as never,
    ]);

    const res = await app.request('/resource-categories');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.total).toBe(1);
  });

  it('returns 404 when category not found', async () => {
    vi.mocked(resourceCategoryService.getByKey).mockResolvedValue(null as never);
    const res = await app.request('/resource-categories/missing');
    expect(res.status).toBe(404);
  });

  it('updates category fields without key mutation', async () => {
    vi.mocked(resourceCategoryService.update).mockResolvedValue({
      _id: 'c1',
      key: 'documents',
      name: 'Docs',
    } as never);

    const res = await app.request('/resource-categories/documents', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Docs' }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.key).toBe('documents');
    expect(body.name).toBe('Docs');
  });

  it('rejects key mutation in update payload', async () => {
    const res = await app.request('/resource-categories/documents', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'other', name: 'Docs' }),
    });

    expect(res.status).toBe(400);
  });

  it('returns 409 when deleting in-use category', async () => {
    vi.mocked(resourceCategoryService.delete).mockRejectedValue(
      new ResourceCategoryError('category is in use', 409, 'CATEGORY_IN_USE')
    );

    const res = await app.request('/resource-categories/documents', {
      method: 'DELETE',
    });

    expect(res.status).toBe(409);
  });
});
