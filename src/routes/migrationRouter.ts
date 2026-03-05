import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import crypto from 'crypto';
import { env } from '../config/env';
import { migrationService, MigrationError } from '../services/migrationService';
import { logService } from '../services/logService';
import { createAdmissionControl, incrementRuntimeCounter } from '../middleware/admissionControl';
import { createApiAuthMiddleware } from './middlewares/apiAuth';

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
  createdAt: z.number().optional().openapi({
    description: 'Resource creation timestamp (milliseconds)',
    example: 1772438656186
  }),
  updatedAt: z.number().optional().openapi({
    description: 'Resource update timestamp (milliseconds)',
    example: 1772438656205
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

const AuthHeadersSchema = z.object({
  authorization: z.string().optional().openapi({
    description: 'Bearer token for internal API authentication',
    example: 'Bearer your-secret-token',
  }),
  'x-migration-token': z.string().optional().openapi({
    description: 'Deprecated: use Authorization Bearer token instead',
    example: 'your-secret-token',
  }),
  'x-errors-token': z.string().optional().openapi({
    description: 'Deprecated: use Authorization Bearer token instead',
    example: 'your-secret-token',
  }),
});

// Create router
const router = new OpenAPIHono();
const migrationRequestTimeoutMs = 60_000;

function createRequestController(rawSignal: AbortSignal, timeoutMs: number): {
  signal: AbortSignal;
  timedOut: () => boolean;
  cleanup: () => void;
} {
  const controller = new AbortController();
  let isTimedOut = false;

  const timeout = setTimeout(() => {
    isTimedOut = true;
    controller.abort();
  }, timeoutMs);

  const onAbort = () => {
    controller.abort();
  };

  rawSignal.addEventListener('abort', onAbort, { once: true });

  return {
    signal: controller.signal,
    timedOut: () => isTimedOut,
    cleanup: () => {
      clearTimeout(timeout);
      rawSignal.removeEventListener('abort', onAbort);
    },
  };
}

// Apply auth middleware to all routes
router.use('*', createApiAuthMiddleware({
  requireMigrationEnabled: true,
}));
router.use('*', createAdmissionControl({
  name: 'migration',
  maxInflight: env.MIGRATION_MAX_INFLIGHT,
  queueMax: env.MIGRATION_QUEUE_MAX,
  queueTimeoutMs: env.MIGRATION_QUEUE_TIMEOUT_MS,
  overloadStatusCode: env.OVERLOAD_STATUS_CODE,
}));

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
      headers: AuthHeadersSchema,
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
    const requestLifecycle = createRequestController(c.req.raw.signal, migrationRequestTimeoutMs);
    try {
      const legacyId = c.req.param('legacyId');
      const contentLengthHeader = c.req.header('content-length') || c.req.header('x-content-length');
      const contentLength = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : NaN;
      if (Number.isFinite(contentLength) && contentLength > env.MIGRATION_MAX_PAYLOAD_BYTES) {
        incrementRuntimeCounter('migrationPayloadTooLargeTotal');
        await logService.logAction({
          action: 'migration_payload_rejected',
          success: false,
          details: {
            legacyId,
            reason: 'content_length_limit',
            contentLength,
            maxPayloadBytes: env.MIGRATION_MAX_PAYLOAD_BYTES,
          },
          note: 'Migration payload rejected before JSON parsing',
          actor: 'migration-router',
        });
        return c.json({
          error: 'Payload too large',
          code: 'PAYLOAD_TOO_LARGE',
        }, 413);
      }
      const body = await c.req.json();
      if (typeof body?.contentBase64 !== 'string') {
        return c.json({ error: 'contentBase64 is required', code: 'INVALID_CONTENT' }, 400);
      }
      if (body.contentBase64.length > env.MIGRATION_MAX_BASE64_CHARS) {
        incrementRuntimeCounter('migrationPayloadTooLargeTotal');
        await logService.logAction({
          action: 'migration_payload_rejected',
          success: false,
          details: {
            legacyId,
            reason: 'base64_length_limit',
            base64Length: body.contentBase64.length,
            maxBase64Chars: env.MIGRATION_MAX_BASE64_CHARS,
          },
          note: 'Migration payload rejected after JSON parsing',
          actor: 'migration-router',
        });
        return c.json({
          error: 'Payload too large',
          code: 'PAYLOAD_TOO_LARGE',
        }, 413);
      }

      const result = await migrationService.importResource({
        legacyId,
        ...body
      }, requestLifecycle.signal);

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
      if (requestLifecycle.timedOut()) {
        incrementRuntimeCounter('requestTimeoutTotal');
        await logService.logAction({
          action: 'migration_request_timeout',
          success: false,
          details: {
            timeoutMs: migrationRequestTimeoutMs,
          },
          note: 'Migration request timed out before completion',
          actor: 'migration-router',
        });
        return c.json({ error: 'Migration request timed out', code: 'REQUEST_TIMEOUT' }, 503);
      }
      if ((error as Error)?.name === 'AbortError' || c.req.raw.signal.aborted) {
        incrementRuntimeCounter('requestAbortedTotal');
        await logService.logAction({
          action: 'migration_request_aborted',
          success: false,
          details: {},
          note: 'Migration request was aborted by client or timeout',
          actor: 'migration-router',
        });
        return c.json({ error: 'Migration request aborted', code: 'REQUEST_ABORTED' }, 408);
      }
      if (error instanceof MigrationError) {
        return c.json({
          error: error.message,
          code: error.code,
        }, error.statusCode as 400 | 401 | 403 | 404 | 409 | 500);
      }

      console.error('Migration error:', error);
      
      // Prepare error response in the same format as the centralized error handler
      // but without hardcoding generic messages
      const errorId = crypto.randomUUID();
      const timestamp = Date.now();
      const requestId = c.req.header('x-request-id') || c.req.header('X-Request-Id') || errorId;
      
      return c.json(
        {
          error: error instanceof Error ? error.message : 'An unexpected server error occurred',
          errorId,
          requestId,
          statusCode: 500,
          timestamp: new Date(timestamp).toISOString(),
        },
        500
      );
    } finally {
      requestLifecycle.cleanup();
    }
  }
);

export default router;
