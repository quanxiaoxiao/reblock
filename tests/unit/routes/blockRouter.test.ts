import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import blockRouter from '../../../src/routes/blockRouter';
import { blockService } from '../../../src/services';

// Mock the blockService
vi.mock('../../../src/services', () => ({
  blockService: {
    list: vi.fn(),
    getById: vi.fn(),
  },
}));

describe('BlockRouter', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.route('/blocks', blockRouter);
    vi.clearAllMocks();
  });

  describe('GET /blocks', () => {
    it('should return list of blocks', async () => {
      const mockBlocks = {
        items: [
          { _id: '1', sha256: 'abc123', linkCount: 1, size: 1024 },
          { _id: '2', sha256: 'def456', linkCount: 2, size: 2048 },
        ],
        total: 2,
      };

      vi.mocked(blockService.list).mockResolvedValue(mockBlocks as never);

      const res = await app.request('/blocks');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual(mockBlocks);
      expect(blockService.list).toHaveBeenCalled();
    });

    it('should handle empty list', async () => {
      vi.mocked(blockService.list).mockResolvedValue({ items: [], total: 0 } as never);

      const res = await app.request('/blocks');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.items).toHaveLength(0);
      expect(body.total).toBe(0);
    });
  });

  describe('GET /blocks/:id', () => {
    it('should return a block by id', async () => {
      const mockBlock = {
        _id: 'block-id-1',
        sha256: 'abc123',
        linkCount: 1,
        size: 1024,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      vi.mocked(blockService.getById).mockResolvedValue(mockBlock as never);

      const res = await app.request('/blocks/block-id-1');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual(mockBlock);
      expect(blockService.getById).toHaveBeenCalledWith('block-id-1');
    });

    it('should return 404 for non-existent block', async () => {
      vi.mocked(blockService.getById).mockResolvedValue(null as never);

      const res = await app.request('/blocks/non-existent-id');
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body).toHaveProperty('error', 'Block not found');
    });

    it('should return 404 for soft-deleted block', async () => {
      vi.mocked(blockService.getById).mockResolvedValue(null as never);

      const res = await app.request('/blocks/deleted-id');
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe('Block not found');
    });
  });
});
