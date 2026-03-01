import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { logService } from '../services/logService';
import { IssueStatus, LogCategory } from '../models/logEntry';

const ErrorListItemSchema = z.object({
  _id: z.string(),
  errorId: z.string().optional(),
  timestamp: z.number(),
  level: z.string(),
  category: z.string(),
  status: z.string(),
  details: z.object({
    errorId: z.string().optional(),
    path: z.string().optional(),
    method: z.string().optional(),
    errorMessage: z.string().optional(),
    errorName: z.string().optional(),
    stack: z.string().optional(),
    clientIp: z.string().optional(),
  }).passthrough(),
  suggestedAction: z.string().optional(),
  resolvedAt: z.number().optional(),
  resolution: z.string().optional(),
  resolvedBy: z.string().optional(),
});

const ErrorDetailSchema = ErrorListItemSchema.extend({
  details: z.object({
    errorId: z.string(),
    path: z.string(),
    method: z.string(),
    clientIp: z.string().optional(),
    errorMessage: z.string(),
    errorName: z.string().optional(),
    stack: z.string().optional(),
    cause: z.string().optional(),
    query: z.record(z.string(), z.string()).optional(),
    params: z.record(z.string(), z.string()).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.unknown().optional(),
  }).passthrough(),
  context: z.object({
    detectedBy: z.string().optional(),
    environment: z.string().optional(),
    requestId: z.string().optional(),
    userAgent: z.string().optional(),
    stackTrace: z.string().optional(),
  }).optional(),
  statusHistory: z.array(z.object({
    status: z.string(),
    changedAt: z.number(),
    changedBy: z.string().optional(),
    note: z.string().optional(),
  })).optional(),
});

const ErrorExportSchema = z.object({
  errorId: z.string(),
  summary: z.string(),
  reproduction: z.object({
    method: z.string(),
    path: z.string(),
    timestamp: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
    query: z.record(z.string(), z.string()).optional(),
    params: z.record(z.string(), z.string()).optional(),
    body: z.unknown().optional(),
  }),
  stackTrace: z.string().optional(),
  suggestedAction: z.string().optional(),
  status: z.string(),
  resolvedAt: z.number().optional(),
  resolution: z.string().optional(),
  resolvedBy: z.string().optional(),
  fixedVersion: z.string().optional(),
});

const ErrorListQuerySchema = z.object({
  days: z.string().optional().default('7'),
  status: z.enum(['open', 'acknowledged', 'resolved', 'all']).optional().default('open'),
  includeResolved: z.string().optional().default('false'),
  limit: z.string().optional().default('100'),
  offset: z.string().optional().default('0'),
});

const ResolveBodySchema = z.object({
  resolution: z.string().min(1),
  fixedVersion: z.string().optional(),
});

const ErrorSchema = z.object({
  error: z.string(),
});

const router = new OpenAPIHono();

// GET /errors - List runtime errors
router.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Errors'],
    description: 'List runtime errors (500 errors)',
    request: {
      query: ErrorListQuerySchema,
    },
    responses: {
      200: {
        description: 'List of runtime errors',
        content: {
          'application/json': {
            schema: z.object({
              total: z.number(),
              errors: z.array(ErrorListItemSchema),
            }),
          },
        },
      },
    },
  }),
  async (c: Context) => {
    const { days, status, includeResolved, limit, offset } = c.req.query();
    
    const daysNum = parseInt(days) || 7;
    const limitNum = parseInt(limit) || 100;
    const offsetNum = parseInt(offset) || 0;
    const includeResolvedBool = includeResolved === 'true';
    
    // Build filter - only RUNTIME_ERROR category
    const filter: any = {
      category: LogCategory.RUNTIME_ERROR,
    };
    
    // Status filter
    if (status !== 'all' && !includeResolvedBool) {
      filter.status = status === 'open' ? IssueStatus.OPEN : status;
    } else if (!includeResolvedBool) {
      filter.status = { $ne: IssueStatus.RESOLVED };
    }
    
    const errors = await logService.findRecent(daysNum, filter);
    
    // Apply pagination
    const total = errors.length;
    const paginatedErrors = errors.slice(offsetNum, offsetNum + limitNum);
    
    return c.json({
      total,
      errors: paginatedErrors.map(e => ({
        _id: e._id,
        errorId: (e.details as any).errorId,
        timestamp: e.timestamp,
        level: e.level,
        category: e.category,
        status: e.status,
        details: {
          errorId: (e.details as any).errorId,
          path: (e.details as any).path,
          method: (e.details as any).method,
          errorMessage: (e.details as any).errorMessage,
          errorName: (e.details as any).errorName,
          stack: (e.details as any).stack,
          clientIp: (e.details as any).clientIp,
        },
        suggestedAction: e.suggestedAction,
        resolvedAt: e.resolvedAt,
        resolution: e.resolution,
        resolvedBy: e.resolvedBy,
      })),
    });
  }
);

// GET /errors/:id - Get error detail
router.openapi(
  createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['Errors'],
    description: 'Get error detail by ID',
    request: {
      params: z.object({
        id: z.string().openapi({
          param: {
            name: 'id',
            in: 'path',
          },
          example: '69a23a307ffd3487af73c550',
        }),
      }),
    },
    responses: {
      200: {
        description: 'Error detail',
        content: {
          'application/json': {
            schema: ErrorDetailSchema,
          },
        },
      },
      404: {
        description: 'Error not found',
        content: {
          'application/json': {
            schema: ErrorSchema,
          },
        },
      },
    },
  }),
  async (c: Context) => {
    const { id } = c.req.param();
    
    const errors = await logService.findRecent(365, {
      category: LogCategory.RUNTIME_ERROR,
    });
    
    const error = errors.find(e => e._id.toString() === id);
    
    if (!error) {
      return c.json({ error: 'Error not found' }, 404);
    }
    
    return c.json(error);
  }
);

// GET /errors/:id/export - Export error in AI-friendly format
router.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/export',
    tags: ['Errors'],
    description: 'Export error in AI-friendly format for debugging',
    request: {
      params: z.object({
        id: z.string().openapi({
          param: {
            name: 'id',
            in: 'path',
          },
          example: '69a23a307ffd3487af73c550',
        }),
      }),
    },
    responses: {
      200: {
        description: 'AI-friendly error export',
        content: {
          'application/json': {
            schema: ErrorExportSchema,
          },
        },
      },
      404: {
        description: 'Error not found',
        content: {
          'application/json': {
            schema: ErrorSchema,
          },
        },
      },
    },
  }),
  async (c: Context) => {
    const { id } = c.req.param();
    
    const errors = await logService.findRecent(365, {
      category: LogCategory.RUNTIME_ERROR,
    });
    
    const error = errors.find(e => e._id.toString() === id);
    
    if (!error) {
      return c.json({ error: 'Error not found' }, 404);
    }
    
    const details = error.details as any;
    
    const exportData = {
      errorId: details.errorId || id,
      summary: details.errorMessage || details.errorName || 'Unknown error',
      reproduction: {
        method: details.method || 'GET',
        path: details.path || '/',
        timestamp: new Date(error.timestamp).toISOString(),
        headers: details.headers,
        query: details.query,
        params: details.params,
        body: details.body,
      },
      stackTrace: details.stack || details.stackTrace,
      suggestedAction: error.suggestedAction,
      status: error.status,
      resolvedAt: error.resolvedAt,
      resolution: error.resolution,
      resolvedBy: error.resolvedBy,
      fixedVersion: (error.context as any)?.serverVersion,
    };
    
    return c.json(exportData);
  }
);

// POST /errors/:id/resolve - Mark error as resolved
router.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/resolve',
    tags: ['Errors'],
    description: 'Mark error as resolved with resolution notes',
    request: {
      params: z.object({
        id: z.string().openapi({
          param: {
            name: 'id',
            in: 'path',
          },
          example: '69a23a307ffd3487af73c550',
        }),
      }),
      body: {
        content: {
          'application/json': {
            schema: ResolveBodySchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Error resolved successfully',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
              message: z.string(),
            }),
          },
        },
      },
      404: {
        description: 'Error not found',
        content: {
          'application/json': {
            schema: ErrorSchema,
          },
        },
      },
    },
  }),
  async (c: Context) => {
    const { id } = c.req.param();
    const { resolution, fixedVersion } = await c.req.json();
    
    try {
      await logService.markResolved(id, resolution);
      
      return c.json({
        success: true,
        message: `Error ${id} marked as resolved`,
      });
    } catch (err: any) {
      if (err.message.includes('not found')) {
        return c.json({ error: 'Error not found' }, 404);
      }
      throw err;
    }
  }
);

// POST /errors/:id/acknowledge - Acknowledge error
router.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/acknowledge',
    tags: ['Errors'],
    description: 'Acknowledge an error',
    request: {
      params: z.object({
        id: z.string().openapi({
          param: {
            name: 'id',
            in: 'path',
          },
          example: '69a23a307ffd3487af73c550',
        }),
      }),
      body: {
        content: {
          'application/json': {
            schema: z.object({
              note: z.string().optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Error acknowledged successfully',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
              message: z.string(),
            }),
          },
        },
      },
      404: {
        description: 'Error not found',
        content: {
          'application/json': {
            schema: ErrorSchema,
          },
        },
      },
    },
  }),
  async (c: Context) => {
    const { id } = c.req.param();
    const { note } = await c.req.json().catch(() => ({}));
    
    try {
      await logService.markAcknowledged(id, note);
      
      return c.json({
        success: true,
        message: `Error ${id} acknowledged`,
      });
    } catch (err: any) {
      if (err.message.includes('not found')) {
        return c.json({ error: 'Error not found' }, 404);
      }
      throw err;
    }
  }
);

export default router;
