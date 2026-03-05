import { z } from 'zod';
import { objectIdSchema } from './blockSchema';

export const createResourceSchema = z.object({
  body: z.object({
    block: objectIdSchema,
    mime: z.string().max(128).optional(),
    entry: objectIdSchema,
    categoryKey: z.string().max(128).optional(),
    description: z.string().max(2048).optional(),
    name: z.string().max(512).optional(),
  })
});

export const updateResourceSchema = z.object({
  body: z.object({
    // block is intentionally excluded from updates — use PATCH /:id/block instead
    mime: z.string().max(128).optional(),
    entry: objectIdSchema.optional(),
    categoryKey: z.string().max(128).optional(),
    description: z.string().max(2048).optional(),
    name: z.string().max(512).optional(),
  }).strict(),
  params: z.object({
    id: objectIdSchema,
  }),
});

export const getResourceByIdSchema = z.object({
  params: z.object({
    id: objectIdSchema,
  }),
});

const categoryKeySchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,127}$/, 'category key must be lowercase slug');

export const createResourceCategorySchema = z.object({
  body: z.object({
    name: z.string().min(1).max(128),
    iconDataUri: z.string().max(32768).optional(),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  }),
});

export const updateResourceCategorySchema = z.object({
  params: z.object({
    key: categoryKeySchema,
  }),
  body: z.object({
    name: z.string().min(1).max(128).optional(),
    iconDataUri: z.string().max(32768).optional(),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  }),
});

export const getResourceCategoryByKeySchema = z.object({
  params: z.object({
    key: categoryKeySchema,
  }),
});
