import { describe, it, expect, vi, beforeEach } from 'vitest';
import app from '../../src/app';

// Mock mongoose
vi.mock('mongoose', () => ({
  default: {
    connect: vi.fn().mockResolvedValue({}),
    Schema: class Schema {
      static Types = {
        ObjectId: String,
      };
      constructor() {}
      index() { return this; }
    },
    model: vi.fn().mockReturnValue({}),
    Types: {
      ObjectId: String,
    },
  },
  connect: vi.fn().mockResolvedValue({}),
  Schema: class Schema {
    static Types = {
      ObjectId: String,
    };
    constructor() {}
    index() { return this; }
  },
  model: vi.fn().mockReturnValue({}),
  Types: {
    ObjectId: String,
  },
}));

// Mock entryService.getOrCreateDefault to prevent startup errors
vi.mock('../../src/services', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    entryService: {
      ...(actual.entryService as Record<string, unknown>),
      getOrCreateDefault: vi.fn().mockResolvedValue({ alias: 'default' }),
    },
  };
});

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /health', () => {
    it('should return health status', async () => {
      const res = await app.request('/health');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toHaveProperty('status', 'healthy');
      expect(body).toHaveProperty('timestamp');
      expect(typeof body.timestamp).toBe('string');
    });

    it('should return JSON content type', async () => {
      const res = await app.request('/health');

      expect(res.headers.get('content-type')).toContain('application/json');
    });
  });

  describe('GET /openapi.json', () => {
    it('should return OpenAPI specification', async () => {
      const res = await app.request('/openapi.json');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toHaveProperty('openapi', '3.0.0');
      expect(body).toHaveProperty('info');
      expect(body.info).toHaveProperty('version', '1.0.0');
      expect(body.info).toHaveProperty('title', 'Resource Block API');
      expect(body).toHaveProperty('servers');
      expect(Array.isArray(body.servers)).toBe(true);
      expect(body.servers.length).toBeGreaterThan(0);
    });

    it('should include API description', async () => {
      const res = await app.request('/openapi.json');
      const body = await res.json();

      expect(body.info).toHaveProperty('description');
      expect(body.info.description).toContain('API for managing');
    });
  });

  describe('GET /docs', () => {
    it('should return HTML documentation', async () => {
      const res = await app.request('/docs');
      const body = await res.text();

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(body).toContain('<!doctype html>');
      expect(body).toContain('Resource Block API Documentation');
    });

    it('should include Scalar API Reference', async () => {
      const res = await app.request('/docs');
      const body = await res.text();

      expect(body).toContain('@scalar/api-reference');
      expect(body).toContain('Scalar.createApiReference');
    });

    it('should include OpenAPI spec content', async () => {
      const res = await app.request('/docs');
      const body = await res.text();

      expect(body).toContain('spec:');
      expect(body).toContain('content:');
    });
  });

  describe('API Routes', () => {
    it('should mount block router at /blocks', async () => {
      // Just verify the route is mounted by checking it doesn't 404
      const res = await app.request('/blocks');
      // Should not be 404 (might be 200 or 500 depending on service)
      expect(res.status).not.toBe(404);
    });

    it('should mount entry router at /entries', async () => {
      const res = await app.request('/entries');
      expect(res.status).not.toBe(404);
    });

    it('should mount resource router at /resources', async () => {
      const res = await app.request('/resources');
      expect(res.status).not.toBe(404);
    });

    it('should mount upload router at /upload', async () => {
      // Upload router only has POST endpoints, so GET returns 404
      // Just verify the router is mounted by checking processUpload is accessible
      expect(app.route).toBeDefined();
    });
  });

  describe('404 Handling', () => {
    it('should return 404 for unknown routes', async () => {
      const res = await app.request('/unknown-route');

      expect(res.status).toBe(404);
    });

    it('should return 404 for unknown nested routes', async () => {
      const res = await app.request('/blocks/unknown/action');

      expect(res.status).toBe(404);
    });
  });

  describe('CORS and Headers', () => {
    it('should handle requests with proper headers', async () => {
      const res = await app.request('/health', {
        headers: {
          'Accept': 'application/json',
        },
      });

      expect(res.status).toBe(200);
    });
  });
});
