import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureRequestBody, getClientIp, getSanitizedHeaders, sanitizeBody } from '@/routes/middlewares/requestCapture';
import type { Context, Next } from 'hono';

describe('requestCapture middleware', () => {
  let mockContext: Context;
  let mockNext: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockNext = vi.fn().mockResolvedValue(undefined);
  });

  describe('sanitizeBody', () => {
    it('should return non-objects as-is', () => {
      expect(sanitizeBody('string')).toBe('string');
      expect(sanitizeBody(123)).toBe(123);
      expect(sanitizeBody(null)).toBe(null);
      expect(sanitizeBody(undefined)).toBe(undefined);
    });

    it('should redact sensitive fields', () => {
      const body = {
        username: 'john',
        password: 'secret123',
        token: 'abc',
      };

      const result = sanitizeBody(body) as any;

      expect(result.username).toBe('john');
      expect(result.password).toBe('[REDACTED]');
      expect(result.token).toBe('[REDACTED]');
    });

    it('should handle nested objects', () => {
      const body = {
        user: {
          name: 'john',
          apiKey: 'secret',
        },
        data: 'value',
      };

      const result = sanitizeBody(body) as any;

      expect(result.user.name).toBe('john');
      expect(result.user.apiKey).toBe('[REDACTED]');
      expect(result.data).toBe('value');
    });

    it('should handle arrays', () => {
      const body = {
        items: [
          { name: 'item1', secret: 'hidden' },
          { name: 'item2', password: 'pass' },
        ],
      };

      const result = sanitizeBody(body) as any;

      expect(result.items[0].name).toBe('item1');
      expect(result.items[0].secret).toBe('[REDACTED]');
      expect(result.items[1].password).toBe('[REDACTED]');
    });

    it('should limit array items to 100', () => {
      const body = {
        items: Array(150).fill({ name: 'item' }),
      };

      const result = sanitizeBody(body) as any;

      expect(result.items.length).toBe(100);
    });

    it('should handle case-insensitive field matching', () => {
      const body = {
        PASSWORD: 'uppercase',
        ApiKey: 'mixed',
        authorization: 'lower',
      };

      const result = sanitizeBody(body) as any;

      expect(result.PASSWORD).toBe('[REDACTED]');
      expect(result.ApiKey).toBe('[REDACTED]');
      expect(result.authorization).toBe('[REDACTED]');
    });

    it('should respect max depth', () => {
      let deep: any = { value: 'test' };
      for (let i = 0; i < 10; i++) {
        deep = { nested: deep };
      }

      const result = sanitizeBody(deep);

      expect(result).toBeDefined();
    });

    it('should handle empty objects', () => {
      expect(sanitizeBody({})).toEqual({});
    });

    it('should handle arrays at top level', () => {
      const body = [{ name: 'a' }, { name: 'b', secret: 'x' }];

      const result = sanitizeBody(body) as any;

      expect(result[0].name).toBe('a');
      expect(result[1].secret).toBe('[REDACTED]');
    });
  });

  describe('getClientIp', () => {
    it('should extract IP from x-forwarded-for', () => {
      mockContext = {
        req: {
          header: vi.fn((name: string) => {
            if (name === 'x-forwarded-for') return '1.2.3.4, 5.6.7.8';
            return null;
          }),
        },
      } as any;

      expect(getClientIp(mockContext)).toBe('1.2.3.4');
    });

    it('should fallback to cf-connecting-ip', () => {
      mockContext = {
        req: {
          header: vi.fn((name: string) => {
            if (name === 'cf-connecting-ip') return '1.1.1.1';
            return null;
          }),
        },
      } as any;

      expect(getClientIp(mockContext)).toBe('1.1.1.1');
    });

    it('should fallback to x-real-ip', () => {
      mockContext = {
        req: {
          header: vi.fn((name: string) => {
            if (name === 'x-real-ip') return '2.2.2.2';
            return null;
          }),
        },
      } as any;

      expect(getClientIp(mockContext)).toBe('2.2.2.2');
    });

    it('should fallback to socket remoteAddress', () => {
      mockContext = {
        req: {
          header: vi.fn().mockReturnValue(null),
          raw: { socket: { remoteAddress: '3.3.3.3' } },
        },
      } as any;

      expect(getClientIp(mockContext)).toBe('3.3.3.3');
    });

    it('should return unknown when no IP found', () => {
      mockContext = {
        req: {
          header: vi.fn().mockReturnValue(null),
          raw: {},
        },
      } as any;

      expect(getClientIp(mockContext)).toBe('unknown');
    });

    it('should handle errors gracefully', () => {
      mockContext = {
        req: {
          header: vi.fn().mockImplementation(() => {
            throw new Error('Header error');
          }),
        },
      } as any;

      expect(getClientIp(mockContext)).toBe('unknown');
    });
  });

  describe('getSanitizedHeaders', () => {
    it('should filter sensitive headers', () => {
      const mockHeaders = new Map([
        ['content-type', 'application/json'],
        ['authorization', 'Bearer token123'],
        ['cookie', 'session=abc'],
        ['x-custom', 'value'],
      ]);

      mockContext = {
        req: {
          raw: { headers: { forEach: (cb: any) => mockHeaders.forEach(cb) } },
        },
      } as any;

      const result = getSanitizedHeaders(mockContext);

      expect(result['content-type']).toBe('application/json');
      expect(result['authorization']).toBeUndefined();
      expect(result['cookie']).toBeUndefined();
      expect(result['x-custom']).toBe('value');
    });

    it('should handle case-insensitive header filtering', () => {
      const mockHeaders = new Map([
        ['Authorization', 'Bearer token'],
        ['X-API-Key', 'secret'],
      ]);

      mockContext = {
        req: {
          raw: { headers: { forEach: (cb: any) => mockHeaders.forEach(cb) } },
        },
      } as any;

      const result = getSanitizedHeaders(mockContext);

      expect(result['Authorization']).toBeUndefined();
      expect(result['X-API-Key']).toBeUndefined();
    });

    it('should handle missing headers', () => {
      mockContext = {
        req: { raw: {} },
      } as any;

      const result = getSanitizedHeaders(mockContext);

      expect(result).toEqual({});
    });

    it('should handle errors gracefully', () => {
      mockContext = {
        req: {
          raw: { headers: null },
        },
      } as any;

      const result = getSanitizedHeaders(mockContext);

      expect(result).toEqual({});
    });
  });

  describe('captureRequestBody', () => {
    beforeEach(() => {
      mockContext = {
        req: {
          path: '/api/test',
          method: 'POST',
          header: vi.fn().mockReturnValue('application/json'),
          text: vi.fn().mockResolvedValue('{"name":"test"}'),
        },
        set: vi.fn(),
      } as any;
    });

    it('should skip upload routes', async () => {
      mockContext.req.path = '/upload/files';

      await captureRequestBody(mockContext, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockContext.set).not.toHaveBeenCalled();
    });

    it('should skip error routes', async () => {
      mockContext.req.path = '/errors/123';

      await captureRequestBody(mockContext, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockContext.set).not.toHaveBeenCalled();
    });

    it('should capture and sanitize JSON body for POST', async () => {
      await captureRequestBody(mockContext, mockNext);

      expect(mockContext.set).toHaveBeenCalledWith('clientIp', expect.any(String));
      expect(mockContext.set).toHaveBeenCalledWith('sanitizedHeaders', expect.any(Object));
      expect(mockContext.set).toHaveBeenCalledWith('requestBody', expect.any(Object));
    });

    it('should capture for PUT requests', async () => {
      mockContext.req.method = 'PUT';

      await captureRequestBody(mockContext, mockNext);

      expect(mockContext.req.text).toHaveBeenCalled();
    });

    it('should capture for PATCH requests', async () => {
      mockContext.req.method = 'PATCH';

      await captureRequestBody(mockContext, mockNext);

      expect(mockContext.req.text).toHaveBeenCalled();
    });

    it('should skip non-JSON content types', async () => {
      mockContext.req.header = vi.fn().mockReturnValue('text/plain');

      await captureRequestBody(mockContext, mockNext);

      expect(mockContext.req.text).not.toHaveBeenCalled();
    });

    it('should skip GET requests', async () => {
      mockContext.req.method = 'GET';

      await captureRequestBody(mockContext, mockNext);

      expect(mockContext.req.text).not.toHaveBeenCalled();
    });

    it('should handle invalid JSON', async () => {
      mockContext.req.text = vi.fn().mockResolvedValue('invalid json');

      await captureRequestBody(mockContext, mockNext);

      expect(mockContext.set).toHaveBeenCalled();
    });

    it('should handle body parse errors', async () => {
      mockContext.req.text = vi.fn().mockRejectedValue(new Error('Parse error'));

      await captureRequestBody(mockContext, mockNext);

      expect(mockContext.set).toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle empty body', async () => {
      mockContext.req.text = vi.fn().mockResolvedValue('');

      await captureRequestBody(mockContext, mockNext);

      expect(mockContext.set).toHaveBeenCalled();
    });
  });
});
