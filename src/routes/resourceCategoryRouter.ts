import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { resourceCategoryService, ResourceCategoryError } from '../services/resourceCategoryService';

const CategoryKeySchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,127}$/).openapi({
  example: 'documents',
  description: 'Global immutable category key (slug)',
});

const ResourceCategorySchema = z.object({
  _id: z.string(),
  key: z.string(),
  name: z.string(),
  iconDataUri: z.string().optional(),
  color: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const CreateCategorySchema = z.object({
  name: z.string().min(1).max(128),
  iconDataUri: z.string().max(32768).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});

const UpdateCategorySchema = z.object({
  name: z.string().min(1).max(128).optional(),
  iconDataUri: z.string().max(32768).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});

const ErrorSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
});

const ResourceCategoryListSchema = z.object({
  items: z.array(ResourceCategorySchema),
  total: z.number(),
});

const router = new OpenAPIHono();

router.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Resource Categories'],
    description: 'Create a global resource category',
    request: {
      body: {
        content: {
          'application/json': {
            schema: CreateCategorySchema,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Category created',
        content: {
          'application/json': {
            schema: ResourceCategorySchema,
          },
        },
      },
      400: {
        description: 'Invalid payload',
        content: {
          'application/json': { schema: ErrorSchema },
        },
      },
    },
  }),
  async (c: Context) => {
    try {
      const body = await c.req.json();
      const created = await resourceCategoryService.create(body);
      return c.json(created, 201);
    } catch (error) {
      if (error instanceof ResourceCategoryError) {
        return c.json({ error: error.message, code: error.code }, error.statusCode as 400 | 409 | 500);
      }
      throw error;
    }
  }
);

router.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Resource Categories'],
    description: 'List global resource categories',
    responses: {
      200: {
        description: 'Category list',
        content: {
          'application/json': { schema: ResourceCategoryListSchema },
        },
      },
    },
  }),
  async (c: Context) => {
    const items = await resourceCategoryService.list();
    return c.json({ items, total: items.length });
  }
);

router.openapi(
  createRoute({
    method: 'get',
    path: '/:key',
    tags: ['Resource Categories'],
    description: 'Get a category by immutable key',
    request: {
      params: z.object({
        key: CategoryKeySchema.openapi({
          param: { name: 'key', in: 'path' },
        }),
      }),
    },
    responses: {
      200: {
        description: 'Category found',
        content: {
          'application/json': { schema: ResourceCategorySchema },
        },
      },
      404: {
        description: 'Category not found',
        content: {
          'application/json': { schema: ErrorSchema },
        },
      },
    },
  }),
  async (c: Context) => {
    const key = c.req.param('key');
    const category = await resourceCategoryService.getByKey(key);
    if (!category) {
      return c.json({ error: 'Category not found' }, 404);
    }
    return c.json(category);
  }
);

router.openapi(
  createRoute({
    method: 'put',
    path: '/:key',
    tags: ['Resource Categories'],
    description: 'Update category presentation fields (name/icon/color). key is immutable.',
    request: {
      params: z.object({
        key: CategoryKeySchema.openapi({
          param: { name: 'key', in: 'path' },
        }),
      }),
      body: {
        content: {
          'application/json': {
            schema: UpdateCategorySchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Category updated',
        content: {
          'application/json': { schema: ResourceCategorySchema },
        },
      },
      400: {
        description: 'Invalid payload',
        content: {
          'application/json': { schema: ErrorSchema },
        },
      },
      404: {
        description: 'Category not found',
        content: {
          'application/json': { schema: ErrorSchema },
        },
      },
    },
  }),
  async (c: Context) => {
    const key = c.req.param('key');
    const body = await c.req.json() as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(body, 'key')) {
      return c.json({ error: 'key is immutable and cannot be updated', code: 'IMMUTABLE_KEY' }, 400);
    }
    try {
      const updated = await resourceCategoryService.update(key, body);
      if (!updated) {
        return c.json({ error: 'Category not found' }, 404);
      }
      return c.json(updated);
    } catch (error) {
      if (error instanceof ResourceCategoryError) {
        return c.json({ error: error.message, code: error.code }, error.statusCode as 400 | 409 | 500);
      }
      throw error;
    }
  }
);

router.openapi(
  createRoute({
    method: 'delete',
    path: '/:key',
    tags: ['Resource Categories'],
    description: 'Delete a category if it is not referenced by any active resource',
    request: {
      params: z.object({
        key: CategoryKeySchema.openapi({
          param: { name: 'key', in: 'path' },
        }),
      }),
    },
    responses: {
      204: {
        description: 'Category deleted',
      },
      404: {
        description: 'Category not found',
        content: {
          'application/json': { schema: ErrorSchema },
        },
      },
      409: {
        description: 'Category is still in use by resources',
        content: {
          'application/json': { schema: ErrorSchema },
        },
      },
    },
  }),
  async (c: Context) => {
    const key = c.req.param('key');
    try {
      const deleted = await resourceCategoryService.delete(key);
      if (!deleted) {
        return c.json({ error: 'Category not found' }, 404);
      }
      return c.body(null, 204);
    } catch (error) {
      if (error instanceof ResourceCategoryError) {
        return c.json({ error: error.message, code: error.code }, error.statusCode as 400 | 409 | 500);
      }
      throw error;
    }
  }
);

export default router;
