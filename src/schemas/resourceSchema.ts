import { z } from 'zod';
import { objectIdSchema } from './blockSchema';

export const createResourceSchema = z.object({
  body: z.object({
    block: objectIdSchema,
    mime: z.string().max(128).optional(),
    entry: objectIdSchema,
    category: z.string().max(128).optional(),
    description: z.string().max(2048).optional(),
    name: z.string().max(512).optional(),
  })
});

export const updateResourceSchema = z.object({
  body: z.object({
    // block and entry are intentionally excluded from updates — use PATCH /:id/block instead
    mime: z.string().max(128).optional(),
    category: z.string().max(128).optional(),
    description: z.string().max(2048).optional(),
    name: z.string().max(512).optional(),
  }),
  params: z.object({
    id: objectIdSchema,
  }),
});

export const getResourceByIdSchema = z.object({
  params: z.object({
    id: objectIdSchema,
  }),
});