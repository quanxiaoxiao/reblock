import type { Context } from 'hono';
import crypto from 'crypto';
import { env } from '../../config/env';

type LegacyTokenSource = 'x-errors-token' | 'x-migration-token';
type TokenSource = 'bearer' | LegacyTokenSource;

interface ExtractedToken {
  token?: string;
  source?: TokenSource;
}

interface ApiAuthMiddlewareOptions {
  requireToken?: boolean;
  allowInTest?: boolean;
  requireMigrationEnabled?: boolean;
  tokenNotConfiguredMessage?: string;
}

const warnedDeprecations = new Set<string>();

function warnOnce(key: string, message: string): void {
  if (warnedDeprecations.has(key)) {
    return;
  }
  warnedDeprecations.add(key);
  console.warn(message);
}

/** Timing-safe token comparison to prevent timing attacks */
export function safeTokenCompare(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

export function resolveConfiguredApiToken(): string | undefined {
  if (env.API_AUTH_TOKEN) {
    return env.API_AUTH_TOKEN;
  }

  const fallback = env.ERRORS_API_TOKEN || env.MIGRATION_API_TOKEN;
  if (fallback) {
    warnOnce(
      'legacy-env-token',
      '[apiAuth] Using deprecated token env (ERRORS_API_TOKEN/MIGRATION_API_TOKEN). Please migrate to API_AUTH_TOKEN.',
    );
  }
  return fallback;
}

export function extractProvidedToken(c: Context): ExtractedToken {
  const authHeader = c.req.header('authorization');
  if (authHeader) {
    const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    if (bearerMatch?.[1]) {
      return { token: bearerMatch[1].trim(), source: 'bearer' };
    }
  }

  const xErrorsToken = c.req.header('x-errors-token');
  if (xErrorsToken) {
    warnOnce(
      'legacy-header-x-errors-token',
      '[apiAuth] x-errors-token is deprecated. Use Authorization: Bearer <token>.',
    );
    return { token: xErrorsToken, source: 'x-errors-token' };
  }

  const xMigrationToken = c.req.header('x-migration-token');
  if (xMigrationToken) {
    warnOnce(
      'legacy-header-x-migration-token',
      '[apiAuth] x-migration-token is deprecated. Use Authorization: Bearer <token>.',
    );
    return { token: xMigrationToken, source: 'x-migration-token' };
  }

  return {};
}

export function createApiAuthMiddleware(options: ApiAuthMiddlewareOptions = {}) {
  const {
    requireToken = true,
    allowInTest = false,
    requireMigrationEnabled = false,
    tokenNotConfiguredMessage = 'API auth token not configured on server',
  } = options;

  return async function apiAuthMiddleware(c: Context, next: () => Promise<void>) {
    if (requireMigrationEnabled && !env.MIGRATION_API_ENABLED) {
      return c.json({ error: 'Migration API is disabled' }, 403);
    }

    if (allowInTest && env.NODE_ENV === 'test') {
      await next();
      return;
    }

    if (!requireToken) {
      await next();
      return;
    }

    const configuredToken = resolveConfiguredApiToken();
    if (!configuredToken) {
      return c.json({ error: tokenNotConfiguredMessage }, 403);
    }

    const { token } = extractProvidedToken(c);
    if (!token || !safeTokenCompare(token, configuredToken)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    await next();
  };
}
