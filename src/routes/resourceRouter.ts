import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createReadStream } from 'fs';
import { Readable, PassThrough } from 'stream';
import { pipeline } from 'stream/promises';
import { resourceService, logService } from '../services';
import { DownloadError } from '../services/resourceService';
import { createDecryptStream, createDecryptStreamWithOffset } from '../utils/crypto';
import { env } from '../config/env';
import { LogLevel, LogCategory, DataLossRisk } from '../models/logEntry';

const ResourceSchema = z.object({
  _id: z.string(),
  block: z.string(),
  mime: z.string().optional(),
  entry: z.string(),
  category: z.string().optional(),
  description: z.string().optional(),
  name: z.string().optional(),
  sha256: z.string().optional(),
  isInvalid: z.boolean().optional(),
  invalidatedAt: z.number().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  clientIp: z.string().optional(),
  userAgent: z.string().optional(),
  uploadDuration: z.number().optional(),
});

const CreateResourceSchema = z.object({
  block: z.string(),
  mime: z.string().optional(),
  entry: z.string(),
  category: z.string().optional(),
  description: z.string().optional(),
  name: z.string().optional(),
});

const UpdateResourceSchema = z.object({
  block: z.string().optional(),
  mime: z.string().optional(),
  entry: z.string().optional(),
  category: z.string().optional(),
  description: z.string().optional(),
  name: z.string().optional(),
});

const ErrorSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
});

const PaginatedResourceListSchema = z.object({
  items: z.array(ResourceSchema),
  total: z.number(),
  limit: z.number().optional(),
  offset: z.number().optional(),
});

const router = new OpenAPIHono();

// Create Resource
router.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Resources'],
    description: 'Create a new resource',
    request: {
      body: {
        content: {
          'application/json': {
            schema: CreateResourceSchema,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Resource created successfully',
        content: {
          'application/json': {
            schema: ResourceSchema,
          },
        },
      },
      400: {
        description: 'Invalid request body',
        content: {
          'application/json': {
            schema: ErrorSchema,
          },
        },
      },
    },
  }),
  async (c: Context) => {
    const body = await c.req.json();
    const result = await resourceService.create(body);
    return c.json(result, 201);
  }
);

// List Resources
router.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Resources'],
    description: 'Get all resources',
    request: {
      query: z.object({
        limit: z.string().optional().openapi({
          param: { name: 'limit', in: 'query' },
          example: '10',
        }),
        offset: z.string().optional().openapi({
          param: { name: 'offset', in: 'query' },
          example: '0',
        }),
        entryAlias: z.string().optional().openapi({
          param: { name: 'entryAlias', in: 'query' },
          description: 'Filter resources by entry alias',
          example: 'some',
        }),
      }),
    },
    responses: {
      200: {
        description: 'List of resources with pagination info',
        content: {
          'application/json': {
            schema: PaginatedResourceListSchema,
          },
        },
      },
    },
  }),
  async (c: Context) => {
    const limitParam = c.req.query('limit');
    const offsetParam = c.req.query('offset');
    const entryAlias = c.req.query('entryAlias');
    const limit = limitParam !== undefined ? parseInt(limitParam, 10) : undefined;
    const offset = offsetParam !== undefined ? parseInt(offsetParam, 10) : undefined;
    const result = await resourceService.list({ entryAlias }, limit, offset);
    return c.json(result);
  }
);

// Get Resource by ID
router.openapi(
  createRoute({
    method: 'get',
    path: '/:id',
    tags: ['Resources'],
    description: 'Get a resource by ID',
    request: {
      params: z.object({
        id: z.string().openapi({
          param: {
            name: 'id',
            in: 'path',
          },
          example: '507f1f77bcf86cd799439011',
        }),
      }),
    },
    responses: {
      200: {
        description: 'Resource found',
        content: {
          'application/json': {
            schema: ResourceSchema,
          },
        },
      },
      404: {
        description: 'Resource not found',
        content: {
          'application/json': {
            schema: ErrorSchema,
          },
        },
      },
    },
  }),
  async (c: Context) => {
    const id = c.req.param('id');
    const result = await resourceService.getById(id);
    if (!result) {
      return c.json({ error: 'Resource not found' }, 404);
    }
    return c.json(result);
  }
);

// Update Resource
router.openapi(
  createRoute({
    method: 'put',
    path: '/:id',
    tags: ['Resources'],
    description: 'Update a resource by ID',
    request: {
      params: z.object({
        id: z.string().openapi({
          param: {
            name: 'id',
            in: 'path',
          },
          example: '507f1f77bcf86cd799439011',
        }),
      }),
      body: {
        content: {
          'application/json': {
            schema: UpdateResourceSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Resource updated successfully',
        content: {
          'application/json': {
            schema: ResourceSchema,
          },
        },
      },
      404: {
        description: 'Resource not found',
        content: {
          'application/json': {
            schema: ErrorSchema,
          },
        },
      },
    },
  }),
  async (c: Context) => {
    const id = c.req.param('id');
    const body = await c.req.json();
    const result = await resourceService.update(id, body);
    if (!result) {
      return c.json({ error: 'Resource not found' }, 404);
    }
    return c.json(result);
  }
);

// Delete Resource
router.openapi(
  createRoute({
    method: 'delete',
    path: '/:id',
    tags: ['Resources'],
    description: 'Delete a resource by ID',
    request: {
      params: z.object({
        id: z.string().openapi({
          param: {
            name: 'id',
            in: 'path',
          },
          example: '507f1f77bcf86cd799439011',
        }),
      }),
    },
    responses: {
      204: {
        description: 'Resource deleted successfully',
      },
      404: {
        description: 'Resource not found',
        content: {
          'application/json': {
            schema: ErrorSchema,
          },
        },
      },
    },
  }),
  async (c: Context) => {
    const id = c.req.param('id');
    const result = await resourceService.delete(id);
    if (!result) {
      return c.json({ error: 'Resource not found' }, 404);
    }
    return c.body(null, 204);
  }
);

// Range parser helper function
function parseRange(header: string, total: number): { start: number; end: number } | null {
  // Support format: bytes=start-end (e.g., bytes=0-499, bytes=500-999)
  const match = header.match(/^bytes=(\d+)-(\d+)?$/);
  if (!match) return null;

  const start = parseInt(match[1], 10);
  const end = match[2] ? parseInt(match[2], 10) : total - 1;

  // Validate range
  if (start < 0 || end < 0 || start > end || start >= total || end >= total) {
    return null;
  }

  return { start, end };
}

// Download Resource with Range support
router.openapi(
  createRoute({
    method: 'get',
    path: '/:id/download',
    tags: ['Resources'],
    description: 'Download a resource file with optional range support for resumable downloads and video streaming',
    request: {
      params: z.object({
        id: z.string().openapi({
          param: {
            name: 'id',
            in: 'path',
          },
          example: '507f1f77bcf86cd799439011',
        }),
      }),
      query: z.object({
        inline: z.string().optional().openapi({
          param: { name: 'inline', in: 'query' },
          description: 'Display inline (for video/audio playback)',
          example: 'true',
        }),
      }),
      headers: z.object({
        range: z.string().optional().openapi({
          description: 'Byte range for partial content (e.g., bytes=0-499)',
          example: 'bytes=0-1023',
        }),
      }),
    },
    responses: {
      200: {
        description: 'Full file content with Accept-Ranges: bytes header',
      },
      206: {
        description: 'Partial content (range request) with Content-Range header',
      },
      416: {
        description: 'Range Not Satisfiable',
        content: {
          'application/json': {
            schema: ErrorSchema,
          },
        },
      },
      404: {
        description: 'Resource not found',
        content: {
          'application/json': {
            schema: ErrorSchema,
          },
        },
      },
      500: {
        description: 'Server error (file missing, size mismatch)',
        content: {
          'application/json': {
            schema: ErrorSchema,
          },
        },
      },
    },
  }),
  async (c: Context) => {
    try {
      const id = c.req.param('id');
      const inline = c.req.query('inline') === 'true';
      const rangeHeader = c.req.header('range');

      // Handle Range request
      if (rangeHeader) {
        // First get resource info to know total size
        const info = await resourceService.download(id);
        const parsed = parseRange(rangeHeader, info.totalSize);

        if (!parsed) {
          // Invalid range
          return c.json({
            error: 'Range Not Satisfiable',
            code: 'INVALID_RANGE',
          }, 416, {
            'Content-Range': `bytes */${info.totalSize}`,
          });
        }

        // Get download with range
        const result = await resourceService.download(id, parsed);

        // Create decrypt stream with offset for AES-CTR range support
        const decryptStream = createDecryptStreamWithOffset(result.iv, result.range!.start);

        // Read file range and pipe through decrypt stream
        // We need to read from the start of the block containing the range start
        const blockSize = 16;
        const blockStart = Math.floor(result.range!.start / blockSize) * blockSize;
        const fileStream = createReadStream(result.filePath, {
          start: blockStart,
          end: result.range!.end,
        });
        
        // Use PassThrough to handle the pipeline
        const passThrough = new PassThrough();
        pipeline(fileStream, decryptStream, passThrough).catch(async (err) => {
          await logService.logIssue({
            level: LogLevel.ERROR,
            category: LogCategory.RUNTIME_ERROR,
            details: {
              operation: 'streamDownloadWithRange',
              resourceId: id,
              error: err.message,
            },
            suggestedAction: 'Check server logs for detailed error information',
            recoverable: true,
            dataLossRisk: DataLossRisk.NONE,
            context: {
              detectedBy: 'resourceService',
              detectedAt: Date.now(),
              environment: env.NODE_ENV as 'development' | 'production' | 'test',
              stackTrace: err.stack,
            },
          });
        });
        
        const webStream = Readable.toWeb(passThrough);
        const disposition = inline ? 'inline' : 'attachment';

        return c.body(webStream, 206, {
          'Content-Type': result.mime,
          'Content-Disposition': `${disposition}; filename="${result.filename}"`,
          'Content-Length': result.size.toString(),
          'Content-Range': `bytes ${result.range!.start}-${result.range!.end}/${result.totalSize}`,
          'Accept-Ranges': 'bytes',
        });
      }

      // Full download (no Range header)
      const result = await resourceService.download(id);
      
      // Create decrypt stream
      const decryptStream = createDecryptStream(result.iv);
      
      // Read file and pipe through decrypt stream
      const fileStream = createReadStream(result.filePath);
      
      // Use PassThrough to handle the pipeline
      const passThrough = new PassThrough();
      pipeline(fileStream, decryptStream, passThrough).catch(async (err) => {
        await logService.logIssue({
          level: LogLevel.ERROR,
          category: LogCategory.RUNTIME_ERROR,
          details: {
            operation: 'streamDownload',
            resourceId: id,
            error: err.message,
          },
          suggestedAction: 'Check server logs for detailed error information',
          recoverable: true,
          dataLossRisk: DataLossRisk.NONE,
          context: {
            detectedBy: 'resourceService',
            detectedAt: Date.now(),
            environment: env.NODE_ENV as 'development' | 'production' | 'test',
            stackTrace: err.stack,
          },
        });
      });
      
      const webStream = Readable.toWeb(passThrough);
      const disposition = inline ? 'inline' : 'attachment';

      return c.body(webStream, 200, {
        'Content-Type': result.mime,
        'Content-Disposition': `${disposition}; filename="${result.filename}"`,
        'Content-Length': result.totalSize.toString(),
        'Accept-Ranges': 'bytes',
      });

    } catch (error) {
      if (error instanceof DownloadError) {
        const status = error.statusCode as 404 | 416 | 500;
        const headers: Record<string, string> = {};

        // For 416 errors, include Content-Range header
        if (status === 416) {
          // We need to get the resource to know total size
          // This is handled above, but for safety:
          headers['Content-Range'] = 'bytes */0';
        }

        return c.json({
          error: error.message,
          code: error.code,
        }, status, headers);
      }
      throw error;
    }
  }
);

export default router;
