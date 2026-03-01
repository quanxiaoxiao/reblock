import { z } from 'zod';

export const createResourceSchema = z.object({
  body: z.object({
    block: z.string(),
    mime: z.string().optional(),
    entry: z.string(),
    category: z.string().optional(),
    description: z.string().optional(),
    name: z.string().optional(),
  })
});

export const updateResourceSchema = z.object({
  body: z.object({
    block: z.string().optional(),
    mime: z.string().optional(),
    entry: z.string().optional(),
    category: z.string().optional(),
    description: z.string().optional(),
    name: z.string().optional(),
  }),
  params: z.object({
    id: z.string(),
  }),
});

export const getResourceByIdSchema = z.object({
  params: z.object({
    id: z.string(),
  }),
});