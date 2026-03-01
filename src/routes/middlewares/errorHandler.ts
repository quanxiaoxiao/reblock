import fs from 'node:fs';
import type { Context, Next } from 'hono';
import { logService } from '../../services/logService';
import { LogLevel, LogCategory, DataLossRisk } from '../../models/logEntry';
import { env } from '../../config/env';

export async function errorHandler(c: Context, next: Next) {
  try {
    await next();
  } catch (err: unknown) {
    const errorId = crypto.randomUUID();
    const timestamp = Date.now();
    const path = c.req.path;
    const method = c.req.method;

    const error = err as Error & { cause?: unknown };

    const clientIp = (c.get('clientIp') as string) || 'unknown';
    const headers = (c.get('sanitizedHeaders') as Record<string, string>) || {};
    const body = c.get('requestBody');

    console.error(`[${errorId}] Server Error:`, {
      errorId,
      timestamp: new Date(timestamp).toISOString(),
      path,
      method,
      clientIp,
      error: error.message,
      stack: error.stack,
      cause: error.cause,
    });

    // Log to file for debugging
    fs.appendFileSync('/tmp/server_errors.log', `${new Date().toISOString()} [${errorId}] Error: ${error.message} path: ${path}\n`);

    try {
      console.log('DEBUG: About to call logService.logIssue');
      await logService.logIssue({
        level: LogLevel.ERROR,
        category: LogCategory.RUNTIME_ERROR,
        details: {
          errorId,
          path,
          method,
          clientIp,
          errorMessage: error.message,
          errorName: error.name,
          stack: error.stack,
          cause: String(error.cause),
          query: Object.fromEntries(c.req.query()),
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
          requestId: c.req.header('x-request-id'),
          userAgent: c.req.header('user-agent'),
          stackTrace: error.stack,
        },
      });
    } catch (logError) {
      console.error(`[${errorId}] Failed to log error to LogService:`, logError);
    }

    return c.json(
      {
        error: error.message || 'Internal Server Error',
        errorId,
        timestamp: new Date(timestamp).toISOString(),
      },
      500
    );
  }
}
