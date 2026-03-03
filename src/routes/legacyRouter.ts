import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createReadStream } from 'fs';
import { Readable, PassThrough } from 'stream';
import { pipeline } from 'stream/promises';
import { resourceService } from '../services';
import { blockService } from '../services/blockService';
import { DownloadError } from '../services/resourceService';
import { metricsSnapshotService } from '../services/metricsSnapshotService';
import { logService } from '../services/logService';
import { createDecryptStream, createDecryptStreamWithOffset } from '../utils/crypto';
import { env } from '../config/env';
import { LogLevel, LogCategory, DataLossRisk } from '../models/logEntry';

const ErrorSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
});

const LegacyResourceSchema = z.object({
  _id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  timeCreate: z.number(),
  timeUpdate: z.number(),
  mime: z.string().optional().nullable(),
  size: z.number(),
  entry: z.string(),
  hash: z.string(),
  category: z.string().optional().nullable(),
});

const router = new OpenAPIHono();

// Range parser helper function (same as resourceRouter)
function parseRange(header: string, total: number): { start: number; end: number } | null {
  const match = header.match(/^bytes=(\d+)-(\d+)?$/);
  if (!match) return null;

  const start = parseInt(match[1], 10);
  const end = match[2] ? parseInt(match[2], 10) : total - 1;

  if (start < 0 || end < 0 || start > end || start >= total || end >= total) {
    return null;
  }

  return { start, end };
}

// GET /api/resource/:id - Get resource metadata in legacy format
router.openapi(
  createRoute({
    method: 'get',
    path: '/api/resource/:id',
    tags: ['Legacy Compatibility'],
    description: 'Get resource metadata in legacy format (backward compatibility)',
    request: {
      params: z.object({
        id: z.string().openapi({
          param: { name: 'id', in: 'path' },
          example: '612ccc0aca4fb7001ace10cf',
        }),
      }),
    },
    responses: {
      200: {
        description: 'Resource metadata in legacy format',
        content: {
          'application/json': {
            schema: LegacyResourceSchema,
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
    
    const resource = await resourceService.getById(id);
    if (!resource) {
      return c.json({ error: 'Resource not found' }, 404);
    }

    // Get block info for size and hash
    const block = await blockService.getById(resource.block.toString());
    if (!block) {
      return c.json({ error: 'Block not found' }, 404);
    }

    const legacyResponse = {
      _id: resource._id.toString(),
      name: resource.name || resource._id.toString(),
      description: resource.description || '',
      timeCreate: resource.createdAt,
      timeUpdate: resource.updatedAt,
      mime: resource.mime || null,
      size: block.size,
      entry: resource.entry.toString(),
      hash: block.sha256,
      category: resource.category || null,
    };

    return c.json(legacyResponse);
  }
);

// Helper function to handle download with optional inline parameter
async function handleDownload(c: Context, id: string, inline: boolean) {
  try {
    const rangeHeader = c.req.header('range');

    // Handle Range request
    if (rangeHeader) {
      const info = await resourceService.download(id);
      const parsed = parseRange(rangeHeader, info.totalSize);

      if (!parsed) {
        return c.json({
          error: 'Range Not Satisfiable',
          code: 'INVALID_RANGE',
        }, 416, {
          'Content-Range': `bytes */${info.totalSize}`,
        });
      }

      const result = await resourceService.download(id, parsed);
      const decryptStream = createDecryptStreamWithOffset(result.iv, result.range!.start);

      const blockSize = 16;
      const blockStart = Math.floor(result.range!.start / blockSize) * blockSize;
      const fileStream = createReadStream(result.filePath, {
        start: blockStart,
        end: result.range!.end,
      });

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
              operation: 'legacyStreamDownloadWithRange',
              resourceId: id,
              error: err.message,
            },
            suggestedAction: 'Check server logs for detailed error information',
            recoverable: true,
            dataLossRisk: DataLossRisk.NONE,
            context: {
              detectedBy: 'system',
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
    const decryptStream = createDecryptStream(result.iv);
    const fileStream = createReadStream(result.filePath);

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
            operation: 'legacyStreamDownload',
            resourceId: id,
            error: err.message,
          },
          suggestedAction: 'Check server logs for detailed error information',
          recoverable: true,
          dataLossRisk: DataLossRisk.NONE,
          context: {
            detectedBy: 'system',
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
      
      if (status === 500) {
        metricsSnapshotService.recordDownloadInterrupted();
      }

      if (status === 416) {
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

// GET /resource/:id - Download resource (attachment)
router.openapi(
  createRoute({
    method: 'get',
    path: '/resource/:id',
    tags: ['Legacy Compatibility'],
    description: 'Download resource file (legacy compatibility, returns attachment)',
    request: {
      params: z.object({
        id: z.string().openapi({
          param: { name: 'id', in: 'path' },
          example: '612ccc0aca4fb7001ace10cf',
        }),
      }),
      headers: z.object({
        range: z.string().optional().openapi({
          description: 'Byte range for partial content',
          example: 'bytes=0-1023',
        }),
      }),
    },
    responses: {
      200: {
        description: 'Full file content with Accept-Ranges header',
      },
      206: {
        description: 'Partial content (range request)',
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
    return handleDownload(c, id, false);
  }
);

// GET /resource/:id/preview - Preview resource (inline)
router.openapi(
  createRoute({
    method: 'get',
    path: '/resource/:id/preview',
    tags: ['Legacy Compatibility'],
    description: 'Preview resource file inline (legacy compatibility)',
    request: {
      params: z.object({
        id: z.string().openapi({
          param: { name: 'id', in: 'path' },
          example: '612ccc0aca4fb7001ace10cf',
        }),
      }),
      headers: z.object({
        range: z.string().optional().openapi({
          description: 'Byte range for partial content',
          example: 'bytes=0-1023',
        }),
      }),
    },
    responses: {
      200: {
        description: 'Full file content with Accept-Ranges header',
      },
      206: {
        description: 'Partial content (range request)',
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
    return handleDownload(c, id, true);
  }
);

export default router;
