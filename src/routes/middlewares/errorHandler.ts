import { appendFile, mkdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import type { Context, Next } from 'hono';
import { logService } from '../../services/logService';
import { LogLevel, LogCategory, DataLossRisk } from '../../models/logEntry';
import { env } from '../../config/env';

/**
 * Core error handling logic used by both middleware and onError handler.
 * This is the main implementation that handles logging and response generation.
 */
async function handleError(err: unknown, c: Context): Promise<Response> {
  const errorId = randomUUID();
  const timestamp = Date.now();
  const path = c.req.path;
  const method = c.req.method;

  const error = err as Error & { cause?: unknown; status?: number; statusCode?: number };
  const rawStatus = Number(error.statusCode ?? error.status);
  const statusCode = Number.isInteger(rawStatus) ? rawStatus : 500;
  const isServerError = statusCode >= 500;

  const clientIp = (c.get('clientIp') as string) || 'unknown';
  const headers = (c.get('sanitizedHeaders') as Record<string, string>) || {};
  const body = c.get('requestBody');
  const requestId = c.req.header('x-request-id') || c.req.header('X-Request-Id') || errorId;
  const fingerprint = createHash('sha256')
    .update(`${method}|${path}|${statusCode}|${error.name}|${error.message}`)
    .digest('hex')
    .slice(0, 16);

  console.error(`[${errorId}] Server Error:`, {
    errorId,
    timestamp: new Date(timestamp).toISOString(),
    path,
    method,
    statusCode,
    clientIp,
    error: error.message,
    stack: error.stack,
    cause: error.cause,
    requestId,
    fingerprint,
  });

  // Best-effort fallback file log for emergency debugging.
  try {
    const fallbackFile = env.ERROR_FALLBACK_LOG_FILE || './storage/_logs/runtime-fallback.log';
    await mkdir(dirname(fallbackFile), { recursive: true });
    await appendFile(
      fallbackFile,
      `${new Date().toISOString()} [${errorId}] ${method} ${path} status=${statusCode} fingerprint=${fingerprint} error=${error.message}\n`,
      'utf-8'
    );
  } catch (fileLogError) {
    console.error(`[${errorId}] Failed to write fallback error log:`, fileLogError);
  }

  if (isServerError) {
    try {
      await logService.logIssue({
        level: LogLevel.ERROR,
        category: LogCategory.RUNTIME_ERROR,
        details: {
          errorId,
          fingerprint,
          path,
          method,
          httpStatus: statusCode,
          clientIp,
          errorMessage: error.message,
          errorName: error.name,
          stack: error.stack,
          cause: String(error.cause),
          query: c.req.query(),
          params: c.req.param(),
          headers,
          body,
        },
        suggestedAction: 'Check server logs for detailed stack trace',
        recoverable: false,
        dataLossRisk: DataLossRisk.NONE,
        context: {
          detectedBy: 'system',
          detectedAt: timestamp,
          environment: env.NODE_ENV,
          requestId,
          userAgent: c.req.header('user-agent'),
          stackTrace: error.stack,
        },
      });
    } catch (logError) {
      console.error(`[${errorId}] Failed to log error to LogService:`, logError);
    }
  }

  return c.json(
    {
      error: error.message || (isServerError ? 'Internal Server Error' : 'Request Failed'),
      errorId,
      requestId,
      statusCode,
      timestamp: new Date(timestamp).toISOString(),
    },
    statusCode
  );
}

/**
 * Middleware-based error handler.
 * Catches errors from subsequent middleware and route handlers.
 * Use with: app.use('*', errorHandler)
 */
export async function errorHandler(c: Context, next: Next): Promise<Response | void> {
  try {
    await next();
    return undefined;
  } catch (err: unknown) {
    return handleError(err, c);
  }
}

/**
 * onError handler for OpenAPIHono.
 * Catches ALL errors including those from OpenAPI routes.
 * Use with: app.onError(onErrorHandler)
 */
export function onErrorHandler(err: Error, c: Context): Response | Promise<Response> {
  return handleError(err, c);
}
