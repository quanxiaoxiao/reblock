import { z } from 'zod';

export const createBlockSchema = z.object({
  body: z.object({
    sha256: z.string().min(1),
    linkCount: z.number().optional(),
    size: z.number().optional(),
  })
});

export const updateBlockSchema = z.object({
  body: z.object({
    sha256: z.string().min(1).optional(),
    linkCount: z.number().optional(),
    size: z.number().optional(),
  }),
  params: z.object({
    id: z.string(),
  }),
});

export const getBlockByIdSchema = z.object({
  params: z.object({
    id: z.string(),
  }),
});
