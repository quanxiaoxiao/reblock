import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { metricsSnapshotService } from '../services/metricsSnapshotService';
import { env } from '../config/env';
import { getAdmissionRuntimeSnapshot, getRuntimeCountersSnapshot } from '../middleware/admissionControl';

const SnapshotSchema = z.object({
  windowStart: z.number(),
  windowEnd: z.number(),
  windowMinutes: z.number(),
  uploadCount: z.number(),
  downloadCount: z.number(),
  uploadBytes: z.number(),
  downloadBytes: z.number(),
  uploadInterruptedCount: z.number(),
  downloadInterruptedCount: z.number(),
});

const router = new OpenAPIHono();
const RuntimeAdmissionSchema = z.object({
  name: z.string(),
  maxInflight: z.number(),
  queueMax: z.number(),
  queueTimeoutMs: z.number(),
  inflight: z.number(),
  queued: z.number(),
  admittedTotal: z.number(),
  queuedTotal: z.number(),
  rejectedTotal: z.number(),
  rejectedQueueFull: z.number(),
  rejectedQueueTimeout: z.number(),
  totalQueueWaitMs: z.number(),
  maxQueueWaitMs: z.number(),
});

const RuntimeCountersSchema = z.object({
  migrationPayloadTooLargeTotal: z.number(),
  requestTimeoutTotal: z.number(),
  requestAbortedTotal: z.number(),
});

const RuntimeMetricsSchema = z.object({
  timestamp: z.number(),
  admission: z.array(RuntimeAdmissionSchema),
  counters: RuntimeCountersSchema,
});

router.openapi(
  createRoute({
    method: 'get',
    path: '/current',
    tags: ['Metrics'],
    description: 'Get transfer metrics snapshot for the recent window (minutes)',
    request: {
      query: z.object({
        minutes: z.string().optional().openapi({
          param: { name: 'minutes', in: 'query' },
          example: '5',
          description: 'Window length in minutes (1-60)',
        }),
      }),
    },
    responses: {
      200: {
        description: 'Current rolling metrics snapshot',
        content: {
          'application/json': {
            schema: SnapshotSchema,
          },
        },
      },
    },
  }),
  (c: Context) => {
    const minutesRaw = c.req.query('minutes');
    const parsedMinutes = minutesRaw ? Number.parseInt(minutesRaw, 10) : env.METRICS_WINDOW_MINUTES;
    const windowMinutes = Number.isFinite(parsedMinutes)
      ? Math.max(1, Math.min(60, parsedMinutes))
      : env.METRICS_WINDOW_MINUTES;

    const snapshot = metricsSnapshotService.getCurrentSnapshot(windowMinutes);
    return c.json(snapshot);
  }
);

router.openapi(
  createRoute({
    method: 'get',
    path: '/runtime',
    tags: ['Metrics'],
    description: 'Get runtime overload protection metrics (admission control and counters)',
    responses: {
      200: {
        description: 'Runtime overload metrics',
        content: {
          'application/json': {
            schema: RuntimeMetricsSchema,
          },
        },
      },
    },
  }),
  (_c: Context) => {
    return _c.json({
      timestamp: Date.now(),
      admission: getAdmissionRuntimeSnapshot(),
      counters: getRuntimeCountersSnapshot(),
    });
  }
);

export default router;
