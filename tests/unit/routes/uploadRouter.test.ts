import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import uploadRouter from '../../../src/routes/uploadRouter';
import { uploadService, entryService, logService } from '../../../src/services';
import { UploadBusinessError } from '../../../src/services/uploadService';

// Mock dependencies
vi.mock('../../../src/services', () => ({
  uploadService: {
    processUpload: vi.fn(),
  },
  entryService: {
    getDefault: vi.fn(),
  },
  logService: {
    logIssue: vi.fn().mockResolvedValue({}),
  },
  auditService: {
    getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
  },
}));

vi.mock('../../../src/config/env', () => ({
  env: {
    STORAGE_TEMP_DIR: '/storage/temp',
  },
}));

vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    open: vi.fn().mockImplementation(() =>
      Promise.resolve({
        write: vi.fn().mockResolvedValue({ bytesWritten: 1024 }),
        close: vi.fn().mockResolvedValue(undefined),
      })
    ),
    stat: vi.fn().mockResolvedValue({ size: 1024 }),
    unlink: vi.fn().mockResolvedValue(undefined),
  },
}));



describe('UploadRouter', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.route('/upload', uploadRouter);
    vi.clearAllMocks();
  });

  describe('POST /upload/:alias', () => {
    it('should handle UploadBusinessError with correct status code', async () => {
      const uploadError = new UploadBusinessError('Entry not found', 404);
      vi.mocked(uploadService.processUpload).mockRejectedValue(uploadError);

      const res = await app.request('/upload/non-existent', {
        method: 'POST',
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3]));
            controller.close();
          }
        }) as any,
        duplex: 'half',
      } as any);

      const body = await res.json();
      expect(body).toHaveProperty('error');
    });

    it('should return 500 for unexpected errors', async () => {
      const { default: fs } = await import('fs/promises');
      const mockedFs = vi.mocked(fs);
      mockedFs.open.mockImplementationOnce(() =>
        Promise.reject(new Error('Unexpected error'))
      );

      const res = await app.request('/upload/test-alias', {
        method: 'POST',
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3]));
            controller.close();
          }
        }) as any,
        duplex: 'half',
      } as any);

      expect(res.status).toBe(500);
      const body = await res.json();
      // Should return actual error message instead of generic "Internal Server Error"
      expect(body).toHaveProperty('error');
      expect(body.error).toContain('Unexpected error');
    });

    it('should log error when unexpected exception occurs', async () => {
      vi.mocked(uploadService.processUpload).mockRejectedValue(
        new Error('Unexpected error')
      );

      await app.request('/upload/test-alias', {
        method: 'POST',
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3]));
            controller.close();
          }
        }) as any,
        duplex: 'half',
      } as any);

      expect(logService.logIssue).toHaveBeenCalled();
    });
  });

  describe('POST /upload (no alias)', () => {
    it('should return 404 when default entry not found', async () => {
      vi.mocked(entryService.getDefault).mockResolvedValue(null);

      const res = await app.request('/upload', {
        method: 'POST',
      });
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body).toHaveProperty('error', 'Default entry not found');
    });
  });

});
