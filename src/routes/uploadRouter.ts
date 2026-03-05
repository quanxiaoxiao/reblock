import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { uploadService, UploadBusinessError } from '../services/uploadService';
import { entryService, logService, auditService } from '../services';
import { metricsSnapshotService } from '../services/metricsSnapshotService';
import { env } from '../config/env';
import { LogLevel, LogCategory, DataLossRisk } from '../models/logEntry';
import { createAdmissionControl, incrementRuntimeCounter } from '../middleware/admissionControl';

const ResourceSchema = z.object({
  _id: z.string(),
  block: z.string(),
  entry: z.string(),
  name: z.string(),
  description: z.string(),
  mime: z.string().optional(),
  categoryKey: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastAccessedAt: z.number(),
  isInvalid: z.boolean().optional(),
  invalidatedAt: z.number().optional(),
  clientIp: z.string().optional(),
  userAgent: z.string().optional(),
  uploadDuration: z.number().optional(),
});

const ErrorSchema = z.object({
  error: z.string(),
});

const router = new OpenAPIHono();
const uploadRequestTimeoutMs = 60_000;

const tempDir = env.STORAGE_TEMP_DIR;

router.use('*', createAdmissionControl({
  name: 'upload',
  maxInflight: env.UPLOAD_MAX_INFLIGHT,
  queueMax: env.UPLOAD_QUEUE_MAX,
  queueTimeoutMs: env.UPLOAD_QUEUE_TIMEOUT_MS,
  overloadStatusCode: env.OVERLOAD_STATUS_CODE,
}));

async function ensureTempDirectory(): Promise<void> {
  try {
    await fs.mkdir(tempDir, { recursive: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }
}

function generateTempFileName(): string {
  const randomBytes = crypto.randomBytes(16).toString('hex');
  return `${randomBytes}.upload`;
}

function createRequestController(rawSignal: AbortSignal, timeoutMs: number): {
  signal: AbortSignal;
  timedOut: () => boolean;
  cleanup: () => void;
} {
  const controller = new AbortController();
  let isTimedOut = false;

  const timeout = setTimeout(() => {
    isTimedOut = true;
    controller.abort();
  }, timeoutMs);

  const onAbort = () => {
    controller.abort();
  };

  rawSignal.addEventListener('abort', onAbort, { once: true });

  return {
    signal: controller.signal,
    timedOut: () => isTimedOut,
    cleanup: () => {
      clearTimeout(timeout);
      rawSignal.removeEventListener('abort', onAbort);
    },
  };
}

// Upload Endpoint
router.openapi(
  createRoute({
    method: 'post',
    path: '/{alias}?',
    tags: ['Upload'],
    description: 'Upload a file to an entry by alias. If no alias provided, uses the default entry.',
    request: {
      params: z.object({
        alias: z.string().optional().openapi({
          param: {
            name: 'alias',
            in: 'path',
          },
          example: 'my-entry-alias',
        }),
      }),
      query: z.object({
        name: z.string().optional().openapi({
          param: {
            name: 'name',
            in: 'query',
          },
          example: 'my-file.txt',
          description: 'The original filename of the uploaded file',
        }),
      }),
    },
    responses: {
      201: {
        description: 'File uploaded successfully',
        content: {
          'application/json': {
            schema: ResourceSchema,
          },
        },
      },
      404: {
        description: 'Entry not found',
        content: {
          'application/json': {
            schema: ErrorSchema,
          },
        },
      },
      500: {
        description: 'Internal server error',
        content: {
          'application/json': {
            schema: ErrorSchema,
          },
        },
      },
    },
  }),
  async (c: Context) => {
    // Record start time for upload duration tracking
    const startTime = Date.now();
    
    let alias = c.req.param('alias');
    
    // If no alias provided, use default entry
    if (!alias) {
      const defaultEntry = await entryService.getDefault();
      if (!defaultEntry) {
        return c.json({ error: 'Default entry not found' }, 404);
      }
      alias = defaultEntry.alias;
    }
    
    // Extract client info for tracking
    const clientIp = auditService.getClientIp(c as any);
    const userAgent = c.req.header('user-agent') || undefined;
    
    // Ensure temp directory exists
    await ensureTempDirectory();
    
    // Generate temp file path
    const tempFileName = generateTempFileName();
    const tempFilePath = path.join(tempDir, tempFileName);
    
    const requestLifecycle = createRequestController(c.req.raw.signal, uploadRequestTimeoutMs);

    try {
      // Stream request body to temp file (no buffering)
      const reader = c.req.raw.body;
      if (!reader) {
        throw new Error('No request body');
      }
      
      const fileHandle = await fs.open(tempFilePath, 'w');
      
      const readerStream = reader.getReader();
      
      try {
        while (true) {
          if (requestLifecycle.signal.aborted) {
            const abortError = new Error('Upload request aborted');
            abortError.name = 'AbortError';
            throw abortError;
          }
          const { done, value } = await readerStream.read();
          if (done) break;
          await fileHandle.write(value);
        }
      } finally {
        readerStream.releaseLock();
        if (fileHandle && typeof fileHandle.close === 'function') {
          await fileHandle.close();
        }
      }
      
      // Check if file is empty
      const stats = await fs.stat(tempFilePath);
      if (stats.size === 0) {
        await fs.unlink(tempFilePath);
        return c.json({ error: 'Empty file' }, 400);
      }

      // Get name from query parameter
      const name = c.req.query('name')?.trim();

      // Get mime from Content-Type header
      const contentType = c.req.header('Content-Type') || c.req.header('content-type');
      const mime = contentType ? contentType.split(';')[0].trim() : undefined;

      // Process upload via service layer with client tracking
      const resource = await uploadService.processUpload(
        alias,
        tempFilePath,
        name,
        mime,
        startTime,
        clientIp,
        userAgent,
        requestLifecycle.signal
      );

      metricsSnapshotService.recordUploadSuccess(stats.size);
      
      return c.json(resource, 201);
    } catch (error) {
      metricsSnapshotService.recordUploadInterrupted();

      // Clean up temp file on error
      try {
        await fs.unlink(tempFilePath);
      } catch {
        // Ignore cleanup errors
      }
      
      if (requestLifecycle.timedOut()) {
        incrementRuntimeCounter('requestTimeoutTotal');
        try {
          await logService.logAction({
            action: 'upload_request_timeout',
            success: false,
            details: {
              alias,
              timeoutMs: uploadRequestTimeoutMs,
            },
            note: 'Upload timed out before completion',
            actor: 'upload-router',
          });
        } catch {
          // best effort
        }
        return c.json({ error: 'Upload request timed out', code: 'REQUEST_TIMEOUT' }, 503);
      }

      if ((error as Error)?.name === 'AbortError' || c.req.raw.signal.aborted) {
        incrementRuntimeCounter('requestAbortedTotal');
        try {
          await logService.logAction({
            action: 'upload_request_aborted',
            success: false,
            details: {
              alias,
            },
            note: 'Upload request was aborted by client or server timeout',
            actor: 'upload-router',
          });
        } catch {
          // best effort
        }
        return c.json({ error: 'Upload request aborted', code: 'REQUEST_ABORTED' }, 408);
      }

      if (error instanceof UploadBusinessError) {
        return c.json({ error: error.message }, error.statusCode as 404);
      }
      
      await logService.logIssue({
        level: LogLevel.ERROR,
        category: LogCategory.RUNTIME_ERROR,
        details: {
          operation: 'processUpload',
          alias,
          error: error instanceof Error ? error.message : String(error),
        },
        suggestedAction: 'Check server logs for detailed error information',
        recoverable: true,
        dataLossRisk: DataLossRisk.NONE,
        context: {
          detectedBy: 'uploadService',
          detectedAt: Date.now(),
          environment: env.NODE_ENV as 'development' | 'production' | 'test',
          stackTrace: error instanceof Error ? error.stack : undefined,
        },
      });
      // Prepare error response with actual error message instead of generic "Internal server error"  
      const errorId = crypto.randomUUID();
      const timestamp = Date.now();
      const requestId = c.req.header('x-request-id') || c.req.header('X-Request-Id') || errorId;
      return c.json(
        {
          error: error instanceof Error ? error.message : 'An unexpected server error occurred',
          errorId,
          requestId,
          statusCode: 500,
          timestamp: new Date(timestamp).toISOString(),
        },
        500
      );
    } finally {
      requestLifecycle.cleanup();
    }
  }
);

export default router;
