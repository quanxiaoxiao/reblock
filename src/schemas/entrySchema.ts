import { z } from 'zod';

const uploadConfigSchema = z.object({
  maxFileSize: z.number().optional(),
  allowedMimeTypes: z.array(z.string()).optional(),
  readOnly: z.boolean().optional(),
}).optional();

export const createEntrySchema = z.object({
  body: z.object({
    name: z.string().min(1),
    alias: z.string().optional(),
    order: z.number().optional(),
    description: z.string().optional(),
    uploadConfig: uploadConfigSchema,
  })
});

export const updateEntrySchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    alias: z.string().optional(),
    order: z.number().optional(),
    description: z.string().optional(),
    uploadConfig: uploadConfigSchema,
  }),
  params: z.object({
    id: z.string(),
  }),
});

export const getEntryByIdSchema = z.object({
  params: z.object({
    id: z.string(),
  }),
});