import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import crypto from 'crypto';
import { logService } from '../services/logService';
import { IssueStatus, LogCategory, LogLevel, DataLossRisk } from '../models/logEntry';
import { env } from '../config/env';

const ErrorListItemSchema = z.object({
  _id: z.string(),
  errorId: z.string().optional(),
  requestId: z.string().optional(),
  fingerprint: z.string().optional(),
  timestamp: z.number(),
  occurrenceCount: z.number().optional(),
  firstSeenAt: z.number().optional(),
  lastSeenAt: z.number().optional(),
  level: z.string(),
  category: z.string(),
  status: z.string(),
  details: z.object({
    errorId: z.string().optional(),
    requestId: z.string().optional(),
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
    expectedStatus: z.number().optional(),
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
  path: z.string().optional(),
  method: z.string().optional(),
  errorName: z.string().optional(),
  errorId: z.string().optional(),
  requestId: z.string().optional(),
  fingerprint: z.string().optional(),
  sort: z.enum(['timestamp']).optional().default('timestamp'),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
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

async function errorsAuthMiddleware(c: Context, next: () => Promise<void>) {
  const configuredToken = env.ERRORS_API_TOKEN || env.MIGRATION_API_TOKEN;
  if (!configuredToken) {
    await next();
    return;
  }

  const xErrorsToken = c.req.header('x-errors-token');
  const xMigrationToken = c.req.header('x-migration-token');
  const authHeader = c.req.header('authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;

  const provided = xErrorsToken || xMigrationToken || bearerToken;
  if (!provided || provided !== configuredToken) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  await next();
}

router.use('*', errorsAuthMiddleware);

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
    const {
      days,
      status,
      includeResolved,
      path,
      method,
      errorName,
      errorId,
      requestId,
      fingerprint,
      order,
      limit,
      offset
    } = c.req.query();
    
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
    
    const logFilter = {
      ...filter,
      path: path || undefined,
      method: method || undefined,
      errorName: errorName || undefined,
      errorId: errorId || undefined,
      requestId: requestId || undefined,
      fingerprint: fingerprint || undefined,
      sortOrder: order === 'asc' ? 'asc' : 'desc' as const,
      limit: limitNum,
      offset: offsetNum,
    };

    const [total, paginatedErrors] = await Promise.all([
      logService.countRecent(daysNum, {
        ...filter,
        path: path || undefined,
        method: method || undefined,
        errorName: errorName || undefined,
        errorId: errorId || undefined,
        requestId: requestId || undefined,
        fingerprint: fingerprint || undefined,
      }),
      logService.findRecent(daysNum, logFilter),
    ]);
    
    return c.json({
      total,
      errors: paginatedErrors.map(e => ({
        _id: e._id,
        errorId: (e.details as any).errorId,
        requestId: e.context?.requestId || (e.details as any).requestId,
        fingerprint: e.fingerprint,
        timestamp: e.timestamp,
        occurrenceCount: e.occurrenceCount,
        firstSeenAt: e.firstSeenAt,
        lastSeenAt: e.lastSeenAt,
        level: e.level,
        category: e.category,
        status: e.status,
        details: {
          errorId: (e.details as any).errorId,
          requestId: (e.details as any).requestId || e.context?.requestId,
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
    
    const error = await logService.findRuntimeErrorById(id);
    
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
    
    const error = await logService.findRuntimeErrorById(id);
    
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
        expectedStatus: typeof details.httpStatus === 'number' ? details.httpStatus : 500,
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
    const { resolution } = await c.req.json();
    
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

// POST /errors/test/create - Create a test error (development/test only)
router.openapi(
  createRoute({
    method: 'post',
    path: '/test/create',
    tags: ['Errors'],
    description: 'Create a test error entry (development/test only)',
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              message: z.string().optional().default('Test error'),
            }),
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Test error created',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
              errorId: z.string(),
              requestId: z.string(),
            }),
          },
        },
      },
      403: {
        description: 'Not allowed in production',
        content: {
          'application/json': {
            schema: z.object({
              error: z.string(),
            }),
          },
        },
      },
    },
  }),
  async (c: Context) => {
    // Only allow in development or test environment
    if (env.NODE_ENV === 'production') {
      return c.json({ error: 'Test error creation not allowed in production' }, 403);
    }

    const { message } = await c.req.json().catch(() => ({ message: 'Test error' }));
    const errorId = crypto.randomUUID();
    const requestId = c.req.header('x-request-id') || c.req.header('X-Request-Id') || `test-${errorId}`;
    const timestamp = Date.now();

    await logService.logIssue({
      level: LogLevel.ERROR,
      category: LogCategory.RUNTIME_ERROR,
      details: {
        errorId,
        path: '/errors/test/create',
        method: 'POST',
        requestId,
        clientIp: '127.0.0.1',
        errorMessage: message,
        errorName: 'TestError',
      },
      suggestedAction: 'This is a test error for testing purposes',
      recoverable: true,
      dataLossRisk: DataLossRisk.NONE,
      context: {
        detectedBy: 'system',
        detectedAt: timestamp,
        environment: env.NODE_ENV as 'development' | 'production' | 'test',
        requestId,
      },
    });

    return c.json({
      success: true,
      errorId,
      requestId,
    }, 201);
  }
);

export default router;
