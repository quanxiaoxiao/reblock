import type { Context, Next } from 'hono';

const SENSITIVE_BODY_FIELDS = [
  'password',
  'token',
  'secret',
  'key',
  'apikey',
  'auth',
  'authorization',
  'access_token',
  'refresh_token',
];

function sanitizeBody(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') return obj;

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const isSensitive = SENSITIVE_BODY_FIELDS.some((field) =>
      key.toLowerCase().includes(field.toLowerCase())
    );
    sanitized[key] = isSensitive ? '[REDACTED]' : value;
  }
  return sanitized;
}

function getClientIp(c: Context): string {
  try {
    const forwarded = c.req.header('x-forwarded-for');
    if (forwarded) return forwarded.split(',')[0].trim();
    
    return c.req.header('cf-connecting-ip')
      || c.req.header('x-real-ip')
      || (c.req.raw as any)?.socket?.remoteAddress
      || 'unknown';
  } catch {
    return 'unknown';
  }
}

function getSanitizedHeaders(c: Context): Record<string, string> {
  const sensitiveHeaders = [
    'authorization',
    'cookie',
    'x-api-key',
    'x-auth-token',
    'x-access-token',
  ];

  const headers: Record<string, string> = {};
  try {
    const rawHeaders = (c.req.raw as any)?.headers;
    if (rawHeaders && typeof rawHeaders.forEach === 'function') {
      rawHeaders.forEach((value: string, key: string) => {
        if (!sensitiveHeaders.includes(key.toLowerCase())) {
          headers[key] = value;
        }
      });
    }
  } catch {
    // Ignore errors in test environment
  }
  return headers;
}

export async function captureRequestBody(c: Context, next: Next) {
  // Skip body capture for routes that need raw body stream (e.g., file uploads)
  // These routes use c.req.raw.body directly
  const path = c.req.path;
  if (path.startsWith('/upload/')) {
    await next();
    return;
  }

  // Only capture body for POST/PUT/PATCH requests with JSON content type
  const contentType = c.req.header('content-type') || c.req.header('Content-Type');
  const isJson = contentType?.includes('application/json');
  
  let sanitizedBody: unknown = {};
  if (isJson && (c.req.method === 'POST' || c.req.method === 'PUT' || c.req.method === 'PATCH')) {
    try {
      const bodyText = await c.req.text();
      if (bodyText) {
        try {
          const parsed = JSON.parse(bodyText);
          sanitizedBody = sanitizeBody(parsed);
        } catch {
          // Invalid JSON, ignore
        }
      }
    } catch {
      // Ignore errors
    }
  }

  c.set('clientIp', getClientIp(c));
  c.set('sanitizedHeaders', getSanitizedHeaders(c));
  c.set('requestBody', sanitizedBody);

  await next();
}

export { getClientIp, getSanitizedHeaders, sanitizeBody };
