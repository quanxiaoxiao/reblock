import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import migrationRouter from '../../../src/routes/migrationRouter';
import { migrationService } from '../../../src/services/migrationService';

vi.mock('../../../src/config/env', () => ({
  env: {
    MIGRATION_API_ENABLED: true,
    API_AUTH_TOKEN: 'test-api-token',
    MIGRATION_API_TOKEN: 'test-migration-token',
    MIGRATION_MAX_INFLIGHT: 2,
    MIGRATION_QUEUE_MAX: 4,
    MIGRATION_QUEUE_TIMEOUT_MS: 200,
    OVERLOAD_STATUS_CODE: 429,
    MIGRATION_MAX_PAYLOAD_BYTES: 128,
    MIGRATION_MAX_BASE64_CHARS: 100,
  },
}));

vi.mock('../../../src/services/logService', () => ({
  logService: {
    logAction: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../../../src/services/migrationService', () => ({
  migrationService: {
    importResource: vi.fn(),
  },
  MigrationError: class MigrationError extends Error {
    statusCode: number;
    code?: string;

    constructor(message: string, statusCode: number, code?: string) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  },
}));

describe('MigrationRouter', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.route('/migration', migrationRouter);
    vi.clearAllMocks();
  });

  it('rejects payload by content-length before JSON parsing', async () => {
    const res = await app.request('/migration/resources/6906d8085481cd13472265cd', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer test-api-token',
        'x-content-length': '9999',
      },
      body: JSON.stringify({
        entryAlias: 'notes',
        name: 'img.jpg',
        contentBase64: 'aGVsbG8=',
      }),
    });

    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.code).toBe('PAYLOAD_TOO_LARGE');
    expect(migrationService.importResource).not.toHaveBeenCalled();
  });

  it('rejects payload by base64 length after JSON parsing', async () => {
    const payload = {
      entryAlias: 'notes',
      name: 'img.jpg',
      contentBase64: 'a'.repeat(101),
    };

    const res = await app.request('/migration/resources/6906d8085481cd13472265ce', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer test-api-token',
      },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.code).toBe('PAYLOAD_TOO_LARGE');
    expect(migrationService.importResource).not.toHaveBeenCalled();
  });

  it('imports resource when payload is valid', async () => {
    vi.mocked(migrationService.importResource).mockResolvedValue({
      isNew: true,
      resource: {
        _id: { toString: () => '6906d8085481cd13472265cf' },
      } as any,
      block: {
        _id: { toString: () => '6906d8085481cd13472265d0' },
        sha256: 'abc123',
        size: 10,
      } as any,
    });

    const payload = {
      entryAlias: 'notes',
      name: 'img.jpg',
      contentBase64: 'aGVsbG8=',
    };

    const res = await app.request('/migration/resources/6906d8085481cd13472265cf', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer test-api-token',
      },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.resourceId).toBe('6906d8085481cd13472265cf');
    expect(migrationService.importResource).toHaveBeenCalledTimes(1);
  });

  it('accepts deprecated x-migration-token header during compatibility period', async () => {
    vi.mocked(migrationService.importResource).mockResolvedValue({
      isNew: false,
      resource: {
        _id: { toString: () => '6906d8085481cd13472265d1' },
      } as any,
      block: {
        _id: { toString: () => '6906d8085481cd13472265d2' },
        sha256: 'def456',
        size: 20,
      } as any,
    });

    const payload = {
      entryAlias: 'notes',
      name: 'legacy-header.jpg',
      contentBase64: 'aGVsbG8=',
    };

    const res = await app.request('/migration/resources/6906d8085481cd13472265d1', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-migration-token': 'test-api-token',
      },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.isNew).toBe(false);
  });
});
