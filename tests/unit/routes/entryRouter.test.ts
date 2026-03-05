import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import entryRouter from '../../../src/routes/entryRouter';
import { entryService, BusinessError } from '../../../src/services';

// Mock the entryService
vi.mock('../../../src/services', () => ({
  entryService: {
    create: vi.fn(),
    list: vi.fn(),
    getById: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  BusinessError: class BusinessError extends Error {
    constructor(message: string, public statusCode: number) {
      super(message);
      this.name = 'BusinessError';
    }
  },
}));

describe('EntryRouter', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.route('/entries', entryRouter);
    vi.clearAllMocks();
  });

  describe('POST /entries', () => {
    it('should create a new entry', async () => {
      const mockEntry = {
        _id: 'entry-id-1',
        name: 'Test Entry',
        alias: 'test-alias',
        isDefault: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      vi.mocked(entryService.create).mockResolvedValue(mockEntry as never);

      const res = await app.request('/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test Entry', alias: 'test-alias' }),
      });
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body).toEqual(mockEntry);
      expect(entryService.create).toHaveBeenCalledWith({ name: 'Test Entry', alias: 'test-alias' });
    });

    it('should return 409 when alias already exists', async () => {
      vi.mocked(entryService.create).mockRejectedValue(
        new (await import('../../../src/services')).BusinessError('alias already exists', 409)
      );

      const res = await app.request('/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test Entry', alias: 'existing-alias' }),
      });
      const body = await res.json();

      expect(res.status).toBe(409);
      expect(body).toHaveProperty('error', 'alias already exists');
    });

    it('should return 400 for invalid request body', async () => {
      const res = await app.request('/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias: 'test-alias' }), // missing required name
      });

      expect(res.status).toBe(400);
    });

    it('should return 400 when retentionMs is non-positive', async () => {
      const res = await app.request('/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Retention Entry',
          uploadConfig: { retentionMs: 0 },
        }),
      });

      expect(res.status).toBe(400);
      expect(entryService.create).not.toHaveBeenCalled();
    });
  });

  describe('GET /entries', () => {
    it('should return list of entries', async () => {
      const mockEntries = {
        items: [
          { _id: '1', name: 'Entry 1', alias: 'entry1' },
          { _id: '2', name: 'Entry 2', alias: 'entry2' },
        ],
        total: 2,
      };

      vi.mocked(entryService.list).mockResolvedValue(mockEntries as never);

      const res = await app.request('/entries');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual(mockEntries);
    });
  });

  describe('GET /entries/:id', () => {
    it('should return an entry by id', async () => {
      const mockEntry = {
        _id: 'entry-id-1',
        name: 'Test Entry',
        alias: 'test-alias',
      };

      vi.mocked(entryService.getById).mockResolvedValue(mockEntry as never);

      const res = await app.request('/entries/entry-id-1');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual(mockEntry);
    });

    it('should return 404 for non-existent entry', async () => {
      vi.mocked(entryService.getById).mockResolvedValue(null as never);

      const res = await app.request('/entries/non-existent-id');
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body).toHaveProperty('error', 'Entry not found');
    });
  });

  describe('PUT /entries/:id', () => {
    it('should update an entry', async () => {
      const mockEntry = {
        _id: 'entry-id-1',
        name: 'Updated Entry',
        alias: 'updated-alias',
        updatedAt: Date.now(),
      };

      vi.mocked(entryService.update).mockResolvedValue(mockEntry as never);

      const res = await app.request('/entries/entry-id-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Entry' }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual(mockEntry);
    });

    it('should return 404 for non-existent entry', async () => {
      vi.mocked(entryService.update).mockResolvedValue(null as never);

      const res = await app.request('/entries/non-existent-id', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Entry' }),
      });
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body).toHaveProperty('error', 'Entry not found');
    });

    it('should return 409 when updating to existing alias', async () => {
      vi.mocked(entryService.update).mockRejectedValue(
        new (await import('../../../src/services')).BusinessError('alias already exists', 409)
      );

      const res = await app.request('/entries/entry-id-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias: 'existing-alias' }),
      });
      const body = await res.json();

      expect(res.status).toBe(409);
      expect(body).toHaveProperty('error', 'alias already exists');
    });

    it('should return 400 when retentionMs has invalid type', async () => {
      const res = await app.request('/entries/entry-id-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploadConfig: { retentionMs: 'abc' },
        }),
      });

      expect(res.status).toBe(400);
      expect(entryService.update).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /entries/:id', () => {
    it('should delete an entry', async () => {
      vi.mocked(entryService.delete).mockResolvedValue({
        _id: 'entry-id-1',
        isInvalid: true,
      } as never);

      const res = await app.request('/entries/entry-id-1', {
        method: 'DELETE',
      });

      expect(res.status).toBe(204);
    });

    it('should return 404 for non-existent entry', async () => {
      vi.mocked(entryService.delete).mockResolvedValue(null as never);

      const res = await app.request('/entries/non-existent-id', {
        method: 'DELETE',
      });
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body).toHaveProperty('error', 'Entry not found');
    });
  });
});
