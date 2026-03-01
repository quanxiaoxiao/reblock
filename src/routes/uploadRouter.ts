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

const ResourceSchema = z.object({
  _id: z.string(),
  block: z.string(),
  entry: z.string(),
  name: z.string(),
  description: z.string(),
  mime: z.string().optional(),
  category: z.string().optional(),
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

const tempDir = env.STORAGE_TEMP_DIR;

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
    let uploadSize = 0;
    
    try {
      // Stream request body to temp file (no buffering)
      const reader = c.req.raw.body;
      if (!reader) {
        throw new Error('No request body');
      }
      
      const fileHandle = await fs.open(tempFilePath, 'w');
      
      try {
        const readerStream = reader.getReader();
        
        while (true) {
          const { done, value } = await readerStream.read();
          if (done) break;
          await fileHandle.write(value);
        }
      } finally {
        await fileHandle.close();
      }
      
      // Check if file is empty
      const stats = await fs.stat(tempFilePath);
      if (stats.size === 0) {
        await fs.unlink(tempFilePath);
        return c.json({ error: 'Empty file' }, 400);
      }
      uploadSize = stats.size;

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
        userAgent
      );

      metricsSnapshotService.recordUploadSuccess(uploadSize);
      
      return c.json(resource, 201);
    } catch (error) {
      metricsSnapshotService.recordUploadInterrupted();

      // Clean up temp file on error
      try {
        await fs.unlink(tempFilePath);
      } catch {
        // Ignore cleanup errors
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
      return c.json({ error: 'Internal server error' }, 500);
    }
  }
);

export default router;
