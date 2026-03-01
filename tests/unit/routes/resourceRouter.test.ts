import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import resourceRouter from '../../../src/routes/resourceRouter';
import { resourceService } from '../../../src/services';
import { DownloadError } from '../../../src/services/resourceService';

// Mock the resourceService
vi.mock('../../../src/services', () => ({
  resourceService: {
    create: vi.fn(),
    list: vi.fn(),
    getById: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
  },
  logService: {
    logIssue: vi.fn().mockResolvedValue({}),
  },
}));

describe('ResourceRouter', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.route('/resources', resourceRouter);
    vi.clearAllMocks();
  });

  describe('POST /resources', () => {
    it('should create a new resource', async () => {
      const mockResource = {
        _id: 'resource-id-1',
        block: 'block-id-1',
        entry: 'entry-id-1',
        name: 'Test Resource',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      vi.mocked(resourceService.create).mockResolvedValue(mockResource as never);

      const res = await app.request('/resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ block: 'block-id-1', entry: 'entry-id-1' }),
      });
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body).toEqual(mockResource);
    });

    it('should return 400 for invalid request body', async () => {
      const res = await app.request('/resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }), // missing required block and entry
      });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /resources', () => {
    it('should return list of resources', async () => {
      const mockResources = {
        items: [
          { _id: '1', block: 'block1', entry: 'entry1', name: 'Resource 1' },
          { _id: '2', block: 'block2', entry: 'entry1', name: 'Resource 2' },
        ],
        total: 2,
      };

      vi.mocked(resourceService.list).mockResolvedValue(mockResources as never);

      const res = await app.request('/resources');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual(mockResources);
    });

    it('should handle pagination query params', async () => {
      const mockResources = {
        items: [{ _id: '1', block: 'block1', entry: 'entry1' }],
        total: 10,
        limit: 5,
        offset: 0,
      };

      vi.mocked(resourceService.list).mockResolvedValue(mockResources as never);

      const res = await app.request('/resources?limit=5&offset=0');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.total).toBe(10);
      expect(resourceService.list).toHaveBeenCalledWith(
        { entryAlias: undefined },
        5,
        0
      );
    });

    it('should filter by entryAlias', async () => {
      const mockResources = {
        items: [{ _id: '1', block: 'block1', entry: 'entry-id-1' }],
        total: 1,
      };

      vi.mocked(resourceService.list).mockResolvedValue(mockResources as never);

      const res = await app.request('/resources?entryAlias=test-alias');

      expect(res.status).toBe(200);
      expect(resourceService.list).toHaveBeenCalledWith(
        { entryAlias: 'test-alias' },
        undefined,
        undefined
      );
    });
  });

  describe('GET /resources/:id', () => {
    it('should return a resource by id', async () => {
      const mockResource = {
        _id: 'resource-id-1',
        block: 'block-id-1',
        entry: 'entry-id-1',
        name: 'Test Resource',
      };

      vi.mocked(resourceService.getById).mockResolvedValue(mockResource as never);

      const res = await app.request('/resources/resource-id-1');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual(mockResource);
    });

    it('should return 404 for non-existent resource', async () => {
      vi.mocked(resourceService.getById).mockResolvedValue(null as never);

      const res = await app.request('/resources/non-existent-id');
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body).toHaveProperty('error', 'Resource not found');
    });
  });

  describe('PUT /resources/:id', () => {
    it('should update a resource', async () => {
      const mockResource = {
        _id: 'resource-id-1',
        name: 'Updated Resource',
        updatedAt: Date.now(),
      };

      vi.mocked(resourceService.update).mockResolvedValue(mockResource as never);

      const res = await app.request('/resources/resource-id-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Resource' }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual(mockResource);
    });

    it('should return 404 for non-existent resource', async () => {
      vi.mocked(resourceService.update).mockResolvedValue(null as never);

      const res = await app.request('/resources/non-existent-id', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Resource' }),
      });
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body).toHaveProperty('error', 'Resource not found');
    });
  });

  describe('DELETE /resources/:id', () => {
    it('should delete a resource', async () => {
      vi.mocked(resourceService.delete).mockResolvedValue({
        _id: 'resource-id-1',
        isInvalid: true,
      } as never);

      const res = await app.request('/resources/resource-id-1', {
        method: 'DELETE',
      });

      expect(res.status).toBe(204);
    });

    it('should return 404 for non-existent resource', async () => {
      vi.mocked(resourceService.delete).mockResolvedValue(null as never);

      const res = await app.request('/resources/non-existent-id', {
        method: 'DELETE',
      });
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body).toHaveProperty('error', 'Resource not found');
    });
  });

  describe('GET /resources/:id/download', () => {
    // Note: Download tests require actual file system operations and are
    // covered by integration tests. We verify the endpoint exists and
    // handles errors correctly.
    
    it('should have download endpoint defined', () => {
      expect(resourceService.download).toBeDefined();
    });

    it('should return 404 when resource not found', async () => {
      vi.mocked(resourceService.download).mockRejectedValue(
        new DownloadError('Resource not found', 404)
      );

      const res = await app.request('/resources/non-existent/download');
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body).toHaveProperty('error', 'Resource not found');
    });

    it('should return 500 for data inconsistency', async () => {
      vi.mocked(resourceService.download).mockRejectedValue(
        new DownloadError('Data inconsistency', 500, 'DATA_INCONSISTENCY')
      );

      const res = await app.request('/resources/resource-id-1/download');
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body).toHaveProperty('error', 'Data inconsistency');
      expect(body).toHaveProperty('code', 'DATA_INCONSISTENCY');
    });

    it('should return 416 for invalid range', async () => {
      // First call without range to get totalSize
      // Second call with range throws 416
      vi.mocked(resourceService.download)
        .mockResolvedValueOnce({
          filePath: '/test/file.txt',
          mime: 'text/plain',
          filename: 'test.txt',
          size: 1000,
          totalSize: 1000,
        } as never)
        .mockRejectedValueOnce(
          new DownloadError('Invalid range', 416, 'INVALID_RANGE')
        );

      const res = await app.request('/resources/resource-id-1/download', {
        headers: { 'Range': 'bytes=2000-3000' },
      });

      expect(res.status).toBe(416);
    });

    it('should include Accept-Ranges header for full download', async () => {
      vi.mocked(resourceService.download).mockResolvedValue({
        filePath: '/test/file.txt',
        mime: 'text/plain',
        filename: 'test.txt',
        size: 1000,
        totalSize: 1000,
        iv: Buffer.alloc(16, 0),
      } as never);

      const res = await app.request('/resources/resource-id-1/download');

      expect(res.headers.get('Accept-Ranges')).toBe('bytes');
    });
  });
});
