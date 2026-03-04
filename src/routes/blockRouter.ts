import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { blockService } from '../services';

const BlockSchema = z.object({
  _id: z.string(),
  sha256: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  linkCount: z.number(),
  size: z.number().optional(),
  isInvalid: z.boolean().optional(),
  invalidatedAt: z.number().optional(),
});

const ErrorSchema = z.object({
  error: z.string(),
});

const PaginatedBlockListSchema = z.object({
  items: z.array(BlockSchema),
  total: z.number(),
  limit: z.number().optional(),
  offset: z.number().optional(),
});

const router = new OpenAPIHono();

// List Blocks
router.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Blocks'],
    description: 'Get all blocks with optional pagination',
    request: {
      query: z.object({
        limit: z.string().optional().openapi({
          param: { name: 'limit', in: 'query' },
          example: '20',
        }),
        offset: z.string().optional().openapi({
          param: { name: 'offset', in: 'query' },
          example: '0',
        }),
      }),
    },
    responses: {
      200: {
        description: 'List of blocks',
        content: {
          'application/json': {
            schema: PaginatedBlockListSchema,
          },
        },
      },
    },
  }),
  async (c: Context) => {
    const limit = c.req.query('limit');
    const offset = c.req.query('offset');
    const result = await blockService.list(
      {},
      limit ? parseInt(limit, 10) : undefined,
      offset ? parseInt(offset, 10) : undefined
    );
    return c.json(result);
  }
);

// Get Block by ID
router.openapi(
  createRoute({
    method: 'get',
    path: '/:id',
    tags: ['Blocks'],
    description: 'Get a block by ID',
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
        description: 'Block found',
        content: {
          'application/json': {
            schema: BlockSchema,
          },
        },
      },
      404: {
        description: 'Block not found',
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
    const result = await blockService.getById(id);
    if (!result) {
      return c.json({ error: 'Block not found' }, 404);
    }
    return c.json(result);
  }
);

export default router;
