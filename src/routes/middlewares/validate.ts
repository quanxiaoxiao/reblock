import { z } from 'zod';
import type { Context, Next } from 'hono';

export const validate =
  (schema: z.ZodSchema<any>) =>
  async (c: Context, next: Next) => {
    const result = schema.safeParse({
      body: await c.req.json().catch(() => ({})),
      params: c.req.param(),
      query: c.req.query(),
    });

    if (!result.success) {
      return c.json(
        {
          error: 'ValidationError',
          details: result.error.flatten(),
        },
        400
      );
    }

    c.set('validated', result.data);

    await next();
  };