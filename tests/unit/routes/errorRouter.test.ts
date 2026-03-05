import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import errorRouter from '../../../src/routes/errorRouter';
import { logService } from '../../../src/services/logService';

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {
    NODE_ENV: 'test',
    API_AUTH_TOKEN: 'test-api-token',
    ERRORS_API_TOKEN: undefined as string | undefined,
    MIGRATION_API_TOKEN: undefined as string | undefined,
  },
}));

vi.mock('../../../src/config/env', () => ({
  env: mockEnv,
}));

vi.mock('../../../src/services/logService', () => ({
  logService: {
    logIssue: vi.fn().mockResolvedValue({}),
    countRecent: vi.fn(),
    findRecent: vi.fn(),
    findRuntimeErrorById: vi.fn(),
    markResolved: vi.fn(),
    markAcknowledged: vi.fn(),
  },
}));

describe('ErrorRouter auth', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.route('/errors', errorRouter);
    vi.clearAllMocks();
    mockEnv.NODE_ENV = 'test';
    mockEnv.API_AUTH_TOKEN = 'test-api-token';
    mockEnv.ERRORS_API_TOKEN = undefined;
    mockEnv.MIGRATION_API_TOKEN = undefined;
  });

  it('accepts Authorization Bearer token', async () => {
    const res = await app.request('/errors/test/create', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-api-token',
      },
      body: JSON.stringify({ message: 'bearer auth success' }),
    });

    expect(res.status).toBe(201);
    expect(logService.logIssue).toHaveBeenCalledTimes(1);
  });

  it('returns 401 when token is missing', async () => {
    const res = await app.request('/errors/test/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'no token' }),
    });

    expect(res.status).toBe(401);
  });

  it('returns 401 when token is invalid', async () => {
    const res = await app.request('/errors/test/create', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer wrong-token',
      },
      body: JSON.stringify({ message: 'invalid token' }),
    });

    expect(res.status).toBe(401);
  });

  it('returns 403 when server token is not configured', async () => {
    mockEnv.API_AUTH_TOKEN = undefined;
    mockEnv.ERRORS_API_TOKEN = undefined;
    mockEnv.MIGRATION_API_TOKEN = undefined;

    const res = await app.request('/errors/test/create', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-api-token',
      },
      body: JSON.stringify({ message: 'no configured token' }),
    });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toContain('not configured');
  });

  it('accepts deprecated x-errors-token header during compatibility period', async () => {
    const res = await app.request('/errors/test/create', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-errors-token': 'test-api-token',
      },
      body: JSON.stringify({ message: 'legacy x-errors-token' }),
    });

    expect(res.status).toBe(201);
  });

  it('accepts deprecated x-migration-token header during compatibility period', async () => {
    const res = await app.request('/errors/test/create', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-migration-token': 'test-api-token',
      },
      body: JSON.stringify({ message: 'legacy x-migration-token' }),
    });

    expect(res.status).toBe(201);
  });
});
