import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createReadStream } from 'fs';
import { Readable, PassThrough } from 'stream';
import { pipeline } from 'stream/promises';
import { resourceService, logService } from '../services';
import { ResourceCategoryError } from '../services/resourceCategoryService';
import { metricsSnapshotService } from '../services/metricsSnapshotService';
import { DownloadError, ResourceMutationError } from '../services/resourceService';
import { createDecryptStream, createDecryptStreamWithOffset } from '../utils/crypto';
import { env } from '../config/env';
import { LogLevel, LogCategory, DataLossRisk } from '../models/logEntry';

/**
 * Encode filename for Content-Disposition header (RFC 5987)
 * Handles non-ASCII characters like Chinese in filenames
 */
function encodeContentDisposition(filename: string): string {
  // Check if filename contains non-ASCII characters
  // eslint-disable-next-line no-control-regex
  if (/[^\x00-\x7F]/.test(filename)) {
    // Use RFC 5987 encoding: filename*=UTF-8''url-encoded-filename
    const encoded = encodeURIComponent(filename);
    return `filename*=UTF-8''${encoded}`;
  }
  // ASCII filename - use traditional format
  return `filename="${filename}"`;
}

const ResourceSchema = z.object({
  _id: z.string(),
  block: z.string(),
  mime: z.string().optional(),
  entry: z.string(),
  categoryKey: z.string().optional(),
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
  categoryKey: z.string().optional(),
  description: z.string().optional(),
  name: z.string().optional(),
});

const UpdateResourceSchema = z.object({
  mime: z.string().optional(),
  entry: z.string().optional(),
  categoryKey: z.string().optional(),
  description: z.string().optional(),
  name: z.string().optional(),
}).strict();

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

const ResourceHistoryItemSchema = z.object({
  _id: z.string(),
  resourceId: z.string(),
  fromBlockId: z.string(),
  toBlockId: z.string(),
  action: z.enum(['swap', 'rollback']),
  changedAt: z.number(),
  changedBy: z.string().optional(),
  reason: z.string().optional(),
  requestId: z.string().optional(),
  rollbackable: z.boolean(),
});

const ResourceHistoryListSchema = z.object({
  total: z.number(),
  items: z.array(ResourceHistoryItemSchema),
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
    try {
      const result = await resourceService.create(body);
      return c.json(result, 201);
    } catch (error) {
      if (error instanceof ResourceCategoryError) {
        return c.json({ error: error.message, code: error.code }, error.statusCode as 400 | 409 | 500);
      }
      throw error;
    }
  }
);

// Update Resource Block with transaction and history tracking
router.openapi(
  createRoute({
    method: 'patch',
    path: '/:id/block',
    tags: ['Resources'],
    description: 'Update resource block while keeping resource ID stable',
    request: {
      params: z.object({
        id: z.string().openapi({
          param: { name: 'id', in: 'path' },
          example: '507f1f77bcf86cd799439011',
        }),
      }),
      body: {
        content: {
          'application/json': {
            schema: z.object({
              newBlockId: z.string(),
              changedBy: z.string().optional(),
              reason: z.string().optional(),
              requestId: z.string().optional(),
              expectedUpdatedAt: z.number().optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Block updated successfully',
        content: {
          'application/json': { schema: ResourceSchema },
        },
      },
      400: { description: 'Invalid input', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'Resource or block not found', content: { 'application/json': { schema: ErrorSchema } } },
      409: { description: 'Version conflict', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c: Context) => {
    const id = c.req.param('id');
    const body = await c.req.json();
    try {
      const updated = await resourceService.updateBlock(id, body);
      return c.json(updated);
    } catch (error) {
      if (error instanceof ResourceMutationError) {
        return c.json({ error: error.message, code: error.code }, error.statusCode as 400 | 404 | 409 | 500);
      }
      throw error;
    }
  }
);

// Get Resource Block Change History
router.openapi(
  createRoute({
    method: 'get',
    path: '/:id/history',
    tags: ['Resources'],
    description: 'Get block change history for a resource',
    request: {
      params: z.object({
        id: z.string().openapi({
          param: { name: 'id', in: 'path' },
          example: '507f1f77bcf86cd799439011',
        }),
      }),
      query: z.object({
        limit: z.string().optional().openapi({
          param: { name: 'limit', in: 'query' },
          example: '50',
        }),
        offset: z.string().optional().openapi({
          param: { name: 'offset', in: 'query' },
          example: '0',
        }),
      }),
    },
    responses: {
      200: {
        description: 'Resource history',
        content: {
          'application/json': { schema: ResourceHistoryListSchema },
        },
      },
      400: { description: 'Invalid resource id', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c: Context) => {
    const id = c.req.param('id');
    const limitParam = c.req.query('limit');
    const offsetParam = c.req.query('offset');
    try {
      const queryParams: { limit?: number; offset?: number } = {};
      if (limitParam) {
        queryParams.limit = parseInt(limitParam, 10);
      }
      if (offsetParam) {
        queryParams.offset = parseInt(offsetParam, 10);
      }
      const result = await resourceService.getHistory(id, queryParams);
      return c.json(result);
    } catch (error) {
      if (error instanceof ResourceMutationError) {
        return c.json({ error: error.message, code: error.code }, error.statusCode as 400 | 404 | 409 | 500);
      }
      throw error;
    }
  }
);

// Rollback Resource Block by History record
router.openapi(
  createRoute({
    method: 'post',
    path: '/:id/rollback',
    tags: ['Resources'],
    description: 'Rollback resource block to previous block from a history record',
    request: {
      params: z.object({
        id: z.string().openapi({
          param: { name: 'id', in: 'path' },
          example: '507f1f77bcf86cd799439011',
        }),
      }),
      body: {
        content: {
          'application/json': {
            schema: z.object({
              historyId: z.string(),
              changedBy: z.string().optional(),
              requestId: z.string().optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Rollback succeeded',
        content: {
          'application/json': { schema: ResourceSchema },
        },
      },
      400: { description: 'Invalid input', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'History not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c: Context) => {
    const id = c.req.param('id');
    const body = await c.req.json();
    try {
      const updated = await resourceService.rollbackBlock(id, body.historyId, body.changedBy, body.requestId);
      return c.json(updated);
    } catch (error) {
      if (error instanceof ResourceMutationError) {
        return c.json({ error: error.message, code: error.code }, error.statusCode as 400 | 404 | 409 | 500);
      }
      throw error;
    }
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
        categoryKey: z.string().optional().openapi({
          param: { name: 'categoryKey', in: 'query' },
          description: 'Filter resources by category key. Use "__none__" to filter uncategorized resources.',
          example: 'documents',
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
    const categoryKey = c.req.query('categoryKey');
    const limit = limitParam !== undefined ? parseInt(limitParam, 10) : undefined;
    const offset = offsetParam !== undefined ? parseInt(offsetParam, 10) : undefined;
    const result = await resourceService.list({ entryAlias, categoryKey }, limit, offset);
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
    description: 'Update a resource by ID. block is immutable here; use PATCH /resources/:id/block to change block binding.',
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
      400: {
        description: 'Invalid request body or invalid entry/category reference',
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
    const id = c.req.param('id');
    const body = await c.req.json();
    try {
      const result = await resourceService.update(id, body);
      if (!result) {
        return c.json({ error: 'Resource not found' }, 404);
      }
      return c.json(result);
    } catch (error) {
      if (error instanceof ResourceCategoryError) {
        return c.json({ error: error.message, code: error.code }, error.statusCode as 400 | 409 | 500);
      }
      if (error instanceof ResourceMutationError) {
        return c.json({ error: error.message, code: error.code }, error.statusCode as 400 | 404 | 409 | 500);
      }
      throw error;
    }
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
export function parseRange(header: string, total: number): { start: number; end: number } | null {
  // Support format: bytes=start-end (e.g., bytes=0-499, bytes=500-999)
  const match = header.match(/^bytes=(\d+)-(\d+)?$/);
  if (!match) return null;

  const start = parseInt(match[1]!, 10);
  const end = match[2] ? parseInt(match[2], 10) : total - 1;

  // Validate range
  if (start < 0 || end < 0 || start > end || start >= total || end >= total) {
    return null;
  }

  return { start, end };
}

/**
 * Handle resource download with Range support
 * Extracted as reusable function to avoid code duplication (DRY principle)
 * @param c Hono Context
 * @param id Resource ID
 * @param inline Whether to display inline (for video/audio) or as attachment
 * @param operationPrefix Prefix for log operations (e.g., 'stream' or 'legacyStream')
 * @returns Response
 */
export async function handleResourceDownload(
  c: Context,
  id: string,
  inline: boolean,
  operationPrefix: string = 'stream'
): Promise<Response> {
  try {
    const rangeHeader = c.req.header('range');

    // Handle Range request
    if (rangeHeader) {
      // Use lightweight metadata call to get totalSize without full download logic
      const meta = await resourceService.downloadMeta(id);
      const parsed = parseRange(rangeHeader, meta.totalSize);

      if (!parsed) {
        // Invalid range
        return c.json({
          error: 'Range Not Satisfiable',
          code: 'INVALID_RANGE',
        }, 416, {
          'Content-Range': `bytes */${meta.totalSize}`,
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
      pipeline(fileStream, decryptStream, passThrough)
        .then(() => {
          metricsSnapshotService.recordDownloadSuccess(result.size);
        })
        .catch(async (err) => {
          // Ensure passThrough is destroyed to free up resources
          if (!passThrough.destroyed) {
            passThrough.destroy(err);
          }
          metricsSnapshotService.recordDownloadInterrupted();
          await logService.logIssue({
            level: LogLevel.ERROR,
            category: LogCategory.RUNTIME_ERROR,
            details: {
              operation: `${operationPrefix}DownloadWithRange`,
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
        'Content-Disposition': `${disposition}; ${encodeContentDisposition(result.filename)}`,
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
    pipeline(fileStream, decryptStream, passThrough)
      .then(() => {
        metricsSnapshotService.recordDownloadSuccess(result.totalSize);
      })
      .catch(async (err) => {
        // Ensure passThrough is destroyed to free up resources
        if (!passThrough.destroyed) {
          passThrough.destroy(err);
        }
        metricsSnapshotService.recordDownloadInterrupted();
        await logService.logIssue({
          level: LogLevel.ERROR,
          category: LogCategory.RUNTIME_ERROR,
          details: {
            operation: `${operationPrefix}Download`,
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
      'Content-Disposition': `${disposition}; ${encodeContentDisposition(result.filename)}`,
      'Content-Length': result.totalSize.toString(),
      'Accept-Ranges': 'bytes',
    });

  } catch (error) {
    if (error instanceof DownloadError) {
      const status = error.statusCode as 404 | 416 | 500;
      const headers: Record<string, string> = {};
      if (status === 500) {
        metricsSnapshotService.recordDownloadInterrupted();
      }

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
    const id = c.req.param('id');
    const inline = c.req.query('inline') === 'true';
    return handleResourceDownload(c, id, inline, 'stream');
  }
);

export default router;
