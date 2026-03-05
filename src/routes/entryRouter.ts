import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { entryService, BusinessError } from '../services';

const EntrySchema = z.object({
  _id: z.string(),
  name: z.string(),
  alias: z.string().optional(),
  parentEntryId: z.string().nullable().optional(),
  isDefault: z.boolean().optional(),
  order: z.number().optional(),
  description: z.string().optional(),
  childrenCount: z.number().int().nonnegative().optional(),
  isInvalid: z.boolean().optional(),
  invalidatedAt: z.number().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  uploadConfig: z.object({
    maxFileSize: z.number().optional(),
    allowedMimeTypes: z.array(z.string()).optional(),
    readOnly: z.boolean().optional(),
    retentionMs: z.number().optional(),
  }).optional(),
});

const CreateEntrySchema = z.object({
  name: z.string().min(1),
  alias: z.string().optional(),
  parentEntryId: z.string().nullable().optional(),
  isDefault: z.boolean().optional(),
  order: z.number().optional(),
  description: z.string().optional(),
  uploadConfig: z.object({
    maxFileSize: z.number().int().positive().optional(),
    allowedMimeTypes: z.array(z.string()).optional(),
    readOnly: z.boolean().optional(),
    retentionMs: z.number().int().positive().optional(),
  }).optional(),
});

const UploadConfigSchema = z.object({
  maxFileSize: z.number().int().positive().optional(),
  allowedMimeTypes: z.array(z.string()).optional(),
  readOnly: z.boolean().optional(),
  retentionMs: z.number().int().positive().optional(),
}).optional();

const UpdateEntrySchema = z.object({
  name: z.string().min(1).optional(),
  alias: z.string().optional(),
  parentEntryId: z.string().nullable().optional(),
  isDefault: z.boolean().optional(),
  order: z.number().optional(),
  description: z.string().optional(),
  uploadConfig: UploadConfigSchema,
});

const ErrorSchema = z.object({
  error: z.string(),
});

const PaginatedEntryListSchema = z.object({
  items: z.array(EntrySchema),
  total: z.number(),
  limit: z.number().optional(),
  offset: z.number().optional(),
});

const router = new OpenAPIHono();

// Create Entry
router.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Entries'],
    description: 'Create a new entry',
    request: {
      body: {
        content: {
          'application/json': {
            schema: CreateEntrySchema,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Entry created successfully',
        content: {
          'application/json': {
            schema: EntrySchema,
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
      409: {
        description: 'Alias already exists',
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
      const result = await entryService.create(body);
      return c.json(result, 201);
    } catch (error) {
      if (error instanceof BusinessError) {
        return c.json({ error: error.message }, error.statusCode as 400 | 409);
      }
      throw error;
    }
  }
);

// List Entries
router.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Entries'],
    description: 'Get all entries with optional pagination',
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
        parentEntryId: z.string().optional().openapi({
          param: { name: 'parentEntryId', in: 'query' },
          example: 'root',
          description: 'Filter by parent entry id. Use "root" (or empty value) for top-level entries.',
        }),
        includeChildrenCount: z.string().optional().openapi({
          param: { name: 'includeChildrenCount', in: 'query' },
          example: 'true',
          description: 'When true, each returned entry includes childrenCount.',
        }),
      }),
    },
    responses: {
      200: {
        description: 'List of entries',
        content: {
          'application/json': {
            schema: PaginatedEntryListSchema,
          },
        },
      },
    },
  }),
  async (c: Context) => {
    const limit = c.req.query('limit');
    const offset = c.req.query('offset');
    const parentEntryIdRaw = c.req.query('parentEntryId');
    const includeChildrenCount = c.req.query('includeChildrenCount') === 'true';

    const filter: Record<string, unknown> = {};
    if (parentEntryIdRaw !== undefined) {
      if (parentEntryIdRaw === '' || parentEntryIdRaw === 'root') {
        filter.$or = [
          { parentEntryId: null },
          { parentEntryId: { $exists: false } },
        ];
      } else if (!z.string().regex(/^[a-f\d]{24}$/i).safeParse(parentEntryIdRaw).success) {
        return c.json({ error: 'parentEntryId is invalid' }, 400);
      } else {
        filter.parentEntryId = parentEntryIdRaw;
      }
    }

    const result = await entryService.list(
      filter,
      limit ? parseInt(limit, 10) : undefined,
      offset ? parseInt(offset, 10) : undefined,
      { includeChildrenCount }
    );
    return c.json(result);
  }
);

// Get Entry by ID
router.openapi(
  createRoute({
    method: 'get',
    path: '/:id',
    tags: ['Entries'],
    description: 'Get an entry by ID',
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
        description: 'Entry found',
        content: {
          'application/json': {
            schema: EntrySchema,
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
    },
  }),
  async (c: Context) => {
    const id = c.req.param('id');
    const result = await entryService.getById(id);
    if (!result) {
      return c.json({ error: 'Entry not found' }, 404);
    }
    return c.json(result);
  }
);

// Update Entry
router.openapi(
  createRoute({
    method: 'put',
    path: '/:id',
    tags: ['Entries'],
    description: 'Update an entry by ID',
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
            schema: UpdateEntrySchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Entry updated successfully',
        content: {
          'application/json': {
            schema: EntrySchema,
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
      400: {
        description: 'Invalid parent entry reference',
        content: {
          'application/json': {
            schema: ErrorSchema,
          },
        },
      },
      409: {
        description: 'Alias already exists',
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
      const result = await entryService.update(id, body);
      if (!result) {
        return c.json({ error: 'Entry not found' }, 404);
      }
      return c.json(result);
    } catch (error) {
      if (error instanceof BusinessError) {
        return c.json({ error: error.message }, error.statusCode as 400 | 409);
      }
      throw error;
    }
  }
);

// Delete Entry
router.openapi(
  createRoute({
    method: 'delete',
    path: '/:id',
    tags: ['Entries'],
    description: 'Delete an entry by ID',
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
        description: 'Entry deleted successfully',
      },
      404: {
        description: 'Entry not found',
        content: {
          'application/json': {
            schema: ErrorSchema,
          },
        },
      },
      409: {
        description: 'Entry has children and cannot be deleted',
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
    try {
      const result = await entryService.delete(id);
      if (!result) {
        return c.json({ error: 'Entry not found' }, 404);
      }
      return c.body(null, 204);
    } catch (error) {
      if (error instanceof BusinessError) {
        return c.json({ error: error.message }, error.statusCode as 400 | 409);
      }
      throw error;
    }
  }
);

export default router;
