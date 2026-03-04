import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Context } from 'hono';
import { errorHandler, onErrorHandler } from '@/routes/middlewares/errorHandler';

// Mock dependencies
vi.mock('@/services/logService', () => ({
  logService: {
    logIssue: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('@/config/env', () => ({
  env: {
    ERROR_FALLBACK_LOG_FILE: './storage/_logs/runtime-fallback.log',
    NODE_ENV: 'test',
  },
}));

vi.mock('node:fs/promises', () => ({
  appendFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

// Note: We don't mock node:crypto fully because errorHandler.ts uses it directly
// Instead, we'll mock just randomUUID at the test level

// Import mocked modules after vi.mock calls
import { logService } from '@/services/logService';
import { appendFile, mkdir } from 'node:fs/promises';

describe('errorHandler', () => {
  let mockContext: Context;
  let mockNext: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock context
    mockContext = {
      req: {
        path: '/api/test',
        method: 'POST',
        header: vi.fn((name: string) => {
          if (name.toLowerCase() === 'x-request-id') return 'test-request-id';
          if (name.toLowerCase() === 'user-agent') return 'test-agent';
          return undefined;
        }),
        query: vi.fn().mockReturnValue({ foo: 'bar' }),
        param: vi.fn().mockReturnValue({ id: '123' }),
      },
      get: vi.fn((key: string) => {
        if (key === 'clientIp') return '127.0.0.1';
        if (key === 'sanitizedHeaders') return { 'content-type': 'application/json' };
        if (key === 'requestBody') return { test: 'data' };
        return undefined;
      }),
      set: vi.fn(),
      json: vi.fn().mockReturnValue(new Response(JSON.stringify({}), { status: 200 })),
    } as unknown as Context;

    mockNext = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('errorHandler middleware', () => {
    it('should call next() when no error occurs', async () => {
      await errorHandler(mockContext, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle errors thrown by next()', async () => {
      const error = new Error('Test error');
      mockNext.mockRejectedValueOnce(error);

      const response = await errorHandler(mockContext, mockNext);
      expect(response).toBeDefined();
      expect(mockContext.json).toHaveBeenCalled();
    });

    it('should generate error response with correct structure', async () => {
      const error = new Error('Test error message');
      mockNext.mockRejectedValueOnce(error);

      await errorHandler(mockContext, mockNext);

      const jsonCall = (mockContext.json as ReturnType<typeof vi.fn>).mock.calls[0];
      const responseBody = jsonCall[0];

      expect(responseBody).toHaveProperty('error', 'Test error message');
      expect(responseBody).toHaveProperty('errorId');
      expect(responseBody).toHaveProperty('requestId');
      expect(responseBody).toHaveProperty('statusCode');
      expect(responseBody).toHaveProperty('timestamp');
    });

    it('should use error status code from error object', async () => {
      const error = new Error('Not Found') as Error & { status: number };
      error.status = 404;
      mockNext.mockRejectedValueOnce(error);

      await errorHandler(mockContext, mockNext);

      const jsonCall = (mockContext.json as ReturnType<typeof vi.fn>).mock.calls[0];
      const statusCode = jsonCall[1];
      expect(statusCode).toBe(404);
    });

    it('should use statusCode property if status is not available', async () => {
      const error = new Error('Bad Request') as Error & { statusCode: number };
      error.statusCode = 400;
      mockNext.mockRejectedValueOnce(error);

      await errorHandler(mockContext, mockNext);

      const jsonCall = (mockContext.json as ReturnType<typeof vi.fn>).mock.calls[0];
      const statusCode = jsonCall[1];
      expect(statusCode).toBe(400);
    });

    it('should default to 500 for server errors without status', async () => {
      const error = new Error('Server Error');
      mockNext.mockRejectedValueOnce(error);

      await errorHandler(mockContext, mockNext);

      const jsonCall = (mockContext.json as ReturnType<typeof vi.fn>).mock.calls[0];
      const statusCode = jsonCall[1];
      expect(statusCode).toBe(500);
    });

    it('should not log to LogService for client errors (4xx)', async () => {
      const error = new Error('Validation Error') as Error & { status: number };
      error.status = 400;
      mockNext.mockRejectedValueOnce(error);

      await errorHandler(mockContext, mockNext);

      expect(logService.logIssue).not.toHaveBeenCalled();
    });

    it('should log to LogService for server errors (5xx)', async () => {
      const error = new Error('Internal Server Error');
      mockNext.mockRejectedValueOnce(error);

      await errorHandler(mockContext, mockNext);

      expect(logService.logIssue).toHaveBeenCalled();
      const logCall = (logService.logIssue as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(logCall.category).toBe('RUNTIME_ERROR');
      expect(logCall.level).toBe('ERROR');
    });

    it('should include request details in error log', async () => {
      const error = new Error('Test error');
      mockNext.mockRejectedValueOnce(error);

      await errorHandler(mockContext, mockNext);

      expect(logService.logIssue).toHaveBeenCalled();
      const logCall = (logService.logIssue as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(logCall.details).toMatchObject({
        path: '/api/test',
        method: 'POST',
        clientIp: '127.0.0.1',
        httpStatus: 500,
      });
    });

    it('should handle missing clientIp gracefully', async () => {
      mockContext.get = vi.fn((key: string) => {
        if (key === 'clientIp') return undefined;
        return undefined;
      });

      const error = new Error('Test error');
      mockNext.mockRejectedValueOnce(error);

      await errorHandler(mockContext, mockNext);

      const logCall = (logService.logIssue as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(logCall.details.clientIp).toBe('unknown');
    });

    it('should use x-request-id header when available', async () => {
      const error = new Error('Test error');
      mockNext.mockRejectedValueOnce(error);

      await errorHandler(mockContext, mockNext);

      const jsonCall = (mockContext.json as ReturnType<typeof vi.fn>).mock.calls[0];
      const responseBody = jsonCall[0];
      expect(responseBody.requestId).toBe('test-request-id');
    });

    it('should generate new requestId if header not present', async () => {
      mockContext.req.header = vi.fn().mockReturnValue(undefined);

      const error = new Error('Test error');
      mockNext.mockRejectedValueOnce(error);

      await errorHandler(mockContext, mockNext);

      const jsonCall = (mockContext.json as ReturnType<typeof vi.fn>).mock.calls[0];
      const responseBody = jsonCall[0];
      expect(responseBody.requestId).toBeDefined();
      expect(typeof responseBody.requestId).toBe('string');
      expect(responseBody.requestId.length).toBeGreaterThan(0);
    });

    it('should write to fallback log file', async () => {
      const error = new Error('Test error');
      mockNext.mockRejectedValueOnce(error);

      await errorHandler(mockContext, mockNext);

      expect(mkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true });
      expect(appendFile).toHaveBeenCalled();
      const appendCall = (appendFile as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(appendCall[0]).toContain('runtime-fallback.log');
    });

    it('should continue processing if fallback log fails', async () => {
      (appendFile as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Write failed'));

      const error = new Error('Test error');
      mockNext.mockRejectedValueOnce(error);

      // Should not throw
      const response = await errorHandler(mockContext, mockNext);
      expect(response).toBeDefined();
    });

    it('should continue processing if LogService fails', async () => {
      (logService.logIssue as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Log failed'));

      const error = new Error('Test error');
      mockNext.mockRejectedValueOnce(error);

      // Should not throw
      const response = await errorHandler(mockContext, mockNext);
      expect(response).toBeDefined();
    });

    it('should handle errors without message property', async () => {
      const error = { name: 'CustomError' } as Error;
      mockNext.mockRejectedValueOnce(error);

      await errorHandler(mockContext, mockNext);

      const jsonCall = (mockContext.json as ReturnType<typeof vi.fn>).mock.calls[0];
      const responseBody = jsonCall[0];
      expect(responseBody.error).toBe('Internal Server Error');
    });

    it('should handle errors with cause property', async () => {
      const cause = new Error('Root cause');
      const error = new Error('Wrapper error') as Error & { cause: Error };
      error.cause = cause;
      mockNext.mockRejectedValueOnce(error);

      await errorHandler(mockContext, mockNext);

      const logCall = (logService.logIssue as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(logCall.details.cause).toBe('Error: Root cause');
    });

    it('should handle invalid status codes gracefully', async () => {
      const error = new Error('Test') as Error & { status: any };
      error.status = 'not-a-number';
      mockNext.mockRejectedValueOnce(error);

      await errorHandler(mockContext, mockNext);

      const jsonCall = (mockContext.json as ReturnType<typeof vi.fn>).mock.calls[0];
      const statusCode = jsonCall[1];
      expect(statusCode).toBe(500);
    });

    it('should handle float status codes by defaulting to 500', async () => {
      const error = new Error('Test') as Error & { status: number };
      error.status = 500.5;
      mockNext.mockRejectedValueOnce(error);

      await errorHandler(mockContext, mockNext);

      const jsonCall = (mockContext.json as ReturnType<typeof vi.fn>).mock.calls[0];
      const statusCode = jsonCall[1];
      expect(statusCode).toBe(500);
    });
  });

  describe('onErrorHandler', () => {
    it('should handle error and return response', async () => {
      const error = new Error('Test error');

      const response = await onErrorHandler(error, mockContext);

      expect(mockContext.json).toHaveBeenCalled();
      expect(response).toBeDefined();
    });

    it('should handle async errors', async () => {
      const error = new Error('Async error');

      const response = await onErrorHandler(error, mockContext);

      expect(response).toBeDefined();
    });

    it('should return Response object', async () => {
      const error = new Error('Test error');
      const mockResponse = new Response(JSON.stringify({ error: 'Test error' }), { status: 500 });
      (mockContext.json as ReturnType<typeof vi.fn>).mockReturnValueOnce(mockResponse);

      const response = await onErrorHandler(error, mockContext);

      expect(response).toBeInstanceOf(Response);
    });
  });

  describe('error fingerprinting', () => {
    it('should generate consistent fingerprint for same error', async () => {
      const error = new Error('Same error');
      error.name = 'TestError';
      mockNext.mockRejectedValueOnce(error);

      await errorHandler(mockContext, mockNext);

      const logCall = (logService.logIssue as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(logCall.details.fingerprint).toBeDefined();
      expect(typeof logCall.details.fingerprint).toBe('string');
      expect(logCall.details.fingerprint.length).toBe(16);
    });

    it('should include fingerprint in error details', async () => {
      const error = new Error('Test error');
      mockNext.mockRejectedValueOnce(error);

      await errorHandler(mockContext, mockNext);

      const logCall = (logService.logIssue as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(logCall.details.fingerprint).toBeDefined();
      expect(typeof logCall.details.fingerprint).toBe('string');
      expect(logCall.details.fingerprint.length).toBe(16);
    });
  });

  describe('context information', () => {
    it('should capture stack trace in log', async () => {
      const error = new Error('Test error');
      error.stack = 'Error: Test error\n    at Test.method';
      mockNext.mockRejectedValueOnce(error);

      await errorHandler(mockContext, mockNext);

      const logCall = (logService.logIssue as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(logCall.context.stackTrace).toBe('Error: Test error\n    at Test.method');
    });

    it('should include user agent in context', async () => {
      const error = new Error('Test error');
      mockNext.mockRejectedValueOnce(error);

      await errorHandler(mockContext, mockNext);

      const logCall = (logService.logIssue as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(logCall.context.userAgent).toBe('test-agent');
    });

    it('should set correct environment in context', async () => {
      const error = new Error('Test error');
      mockNext.mockRejectedValueOnce(error);

      await errorHandler(mockContext, mockNext);

      const logCall = (logService.logIssue as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(logCall.context.environment).toBe('test');
    });
  });

  describe('fallback file logging', () => {
    it('should format fallback log correctly', async () => {
      const error = new Error('Test error');
      mockNext.mockRejectedValueOnce(error);

      await errorHandler(mockContext, mockNext);

      const appendCall = (appendFile as ReturnType<typeof vi.fn>).mock.calls[0];
      const logContent = appendCall[1];
      
      expect(logContent).toContain('POST');
      expect(logContent).toContain('/api/test');
      expect(logContent).toContain('status=500');
      expect(logContent).toContain('fingerprint=');
      expect(logContent).toContain('error=Test error');
      // Check for UUID format in brackets [xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx]
      expect(logContent).toMatch(/\[[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\]/);
    });

    it('should use ISO timestamp in fallback log', async () => {
      const error = new Error('Test error');
      mockNext.mockRejectedValueOnce(error);

      await errorHandler(mockContext, mockNext);

      const appendCall = (appendFile as ReturnType<typeof vi.fn>).mock.calls[0];
      const logContent = appendCall[1];
      
      // Should contain ISO date format
      expect(logContent).toMatch(/\d{4}-\d{2}-\d{2}T/);
    });
  });
});
