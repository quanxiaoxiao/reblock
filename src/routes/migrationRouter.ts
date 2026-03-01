import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { env } from '../config/env';
import { migrationService, MigrationError } from '../services/migrationService';

// Schema definitions
const ImportResourceSchema = z.object({
  entryAlias: z.string().min(1).openapi({
    description: 'Entry alias for the resource',
    example: 'notes'
  }),
  name: z.string().min(1).openapi({
    description: 'Resource name',
    example: 'Y86.html'
  }),
  mime: z.string().optional().openapi({
    description: 'MIME type',
    example: 'text/html'
  }),
  category: z.string().optional().openapi({
    description: 'Resource category',
    example: 'documentation'
  }),
  description: z.string().optional().openapi({
    description: 'Resource description',
    example: 'Y86 processor documentation'
  }),
  contentBase64: z.string().min(1).openapi({
    description: 'Base64 encoded file content',
    example: 'PGh0bWw+...'
  }),
}).openapi('ImportResourceRequest');

const ImportResourceResponseSchema = z.object({
  success: z.boolean(),
  resourceId: z.string(),
  isNew: z.boolean(),
  blockId: z.string(),
  sha256: z.string(),
  size: z.number(),
}).openapi('ImportResourceResponse');

const ErrorResponseSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
}).openapi('ErrorResponse');

// Create router
const router = new OpenAPIHono();

// Authentication middleware
async function migrationAuthMiddleware(c: Context, next: () => Promise<void>) {
  // Check if migration API is enabled
  if (!env.MIGRATION_API_ENABLED) {
    return c.json({ error: 'Migration API is disabled' }, 403);
  }

  // Check token
  const token = c.req.header('x-migration-token');
  if (!token || token !== env.MIGRATION_API_TOKEN) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  await next();
}

// Apply auth middleware to all routes
router.use('*', migrationAuthMiddleware);

// POST /migration/resources/:legacyId
router.openapi(
  createRoute({
    method: 'post',
    path: '/resources/:legacyId',
    tags: ['Migration (Internal)'],
    description: 'Import a resource with a legacy ID from an old system. This endpoint is for data migration only.',
    request: {
      params: z.object({
        legacyId: z.string().min(1).openapi({
          description: 'Legacy resource ID (must be a valid MongoDB ObjectId)',
          example: '6906d8085481cd13472265cd'
        })
      }),
      body: {
        content: {
          'application/json': {
            schema: ImportResourceSchema,
          },
        },
      },
      headers: z.object({
        'x-migration-token': z.string().openapi({
          description: 'Migration API authentication token',
          example: 'your-secret-token'
        })
      })
    },
    responses: {
      201: {
        description: 'Resource imported successfully',
        content: {
          'application/json': {
            schema: ImportResourceResponseSchema,
          },
        },
      },
      200: {
        description: 'Resource already exists (idempotent)',
        content: {
          'application/json': {
            schema: ImportResourceResponseSchema,
          },
        },
      },
      400: {
        description: 'Bad request - invalid parameters',
        content: {
          'application/json': {
            schema: ErrorResponseSchema,
          },
        },
      },
      401: {
        description: 'Unauthorized - invalid or missing token',
        content: {
          'application/json': {
            schema: ErrorResponseSchema,
          },
        },
      },
      403: {
        description: 'Forbidden - migration API disabled',
        content: {
          'application/json': {
            schema: ErrorResponseSchema,
          },
        },
      },
      404: {
        description: 'Entry not found',
        content: {
          'application/json': {
            schema: ErrorResponseSchema,
          },
        },
      },
      409: {
        description: 'Conflict - resource ID already exists with different content',
        content: {
          'application/json': {
            schema: ErrorResponseSchema,
          },
        },
      },
      500: {
        description: 'Internal server error',
        content: {
          'application/json': {
            schema: ErrorResponseSchema,
          },
        },
      },
    },
  }),
  async (c: Context) => {
    try {
      const legacyId = c.req.param('legacyId');
      const body = await c.req.json();

      const result = await migrationService.importResource({
        legacyId,
        ...body
      });

      const statusCode = result.isNew ? 201 : 200;

      return c.json({
        success: true,
        resourceId: result.resource._id.toString(),
        isNew: result.isNew,
        blockId: result.block._id.toString(),
        sha256: result.block.sha256,
        size: result.block.size,
      }, statusCode);

    } catch (error) {
      if (error instanceof MigrationError) {
        return c.json({
          error: error.message,
          code: error.code,
        }, error.statusCode as 400 | 401 | 403 | 404 | 409 | 500);
      }

      console.error('Migration error:', error);
      return c.json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      }, 500);
    }
  }
);

export default router;
