import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { metricsSnapshotService } from '../services/metricsSnapshotService';
import { env } from '../config/env';

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

export default router;
