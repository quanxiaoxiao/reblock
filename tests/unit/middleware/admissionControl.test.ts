import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { createAdmissionControl } from '../../../src/middleware/admissionControl';

vi.mock('../../../src/services/logService', () => ({
  logService: {
    logAction: vi.fn().mockResolvedValue({}),
  },
}));

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('admissionControl middleware', () => {
  it('admits request when below inflight limit', async () => {
    const app = new Hono();
    app.use('*', createAdmissionControl({
      name: `admission-test-admit-${Date.now()}`,
      maxInflight: 2,
      queueMax: 2,
      queueTimeoutMs: 100,
      overloadStatusCode: 429,
    }));
    app.get('/test', (c) => c.json({ ok: true }, 200));

    const res = await app.request('/test');
    expect(res.status).toBe(200);
  });

  it('queues and admits when slot becomes available', async () => {
    const app = new Hono();
    app.use('*', createAdmissionControl({
      name: `admission-test-queue-${Date.now()}`,
      maxInflight: 1,
      queueMax: 2,
      queueTimeoutMs: 500,
      overloadStatusCode: 429,
    }));
    app.get('/test', async (c) => {
      await sleep(40);
      return c.json({ ok: true }, 200);
    });

    const first = app.request('/test');
    const second = app.request('/test');

    const [res1, res2] = await Promise.all([first, second]);
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
  });

  it('rejects immediately when queue is full', async () => {
    const app = new Hono();
    app.use('*', createAdmissionControl({
      name: `admission-test-full-${Date.now()}`,
      maxInflight: 1,
      queueMax: 1,
      queueTimeoutMs: 500,
      overloadStatusCode: 429,
    }));
    app.get('/test', async (c) => {
      await sleep(100);
      return c.json({ ok: true }, 200);
    });

    const first = app.request('/test');
    const second = app.request('/test');
    const third = app.request('/test');

    const thirdRes = await third;
    expect(thirdRes.status).toBe(429);
    const body = await thirdRes.json();
    expect(body.code).toBe('SERVER_OVERLOADED');

    await Promise.all([first, second]);
  });

  it('rejects queued request when queue wait exceeds timeout', async () => {
    const app = new Hono();
    app.use('*', createAdmissionControl({
      name: `admission-test-timeout-${Date.now()}`,
      maxInflight: 1,
      queueMax: 1,
      queueTimeoutMs: 20,
      overloadStatusCode: 429,
    }));
    app.get('/test', async (c) => {
      await sleep(100);
      return c.json({ ok: true }, 200);
    });

    const first = app.request('/test');
    const second = await app.request('/test');

    expect(second.status).toBe(429);
    const body = await second.json();
    expect(body.code).toBe('SERVER_OVERLOADED');
    expect(second.headers.get('retry-after')).toBeTruthy();

    await first;
  });
});
