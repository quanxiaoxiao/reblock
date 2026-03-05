import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { resourceService } from '../services';
import { blockService } from '../services/blockService';
import { handleResourceDownload } from './resourceRouter';

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
    return handleResourceDownload(c, id, false, 'legacyStream');
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
    return handleResourceDownload(c, id, true, 'legacyStream');
  }
);

export default router;
