import { z } from 'zod';
import { objectIdSchema } from './blockSchema';

const uploadConfigSchema = z.object({
  maxFileSize: z.number().int().positive().optional(),
  allowedMimeTypes: z.array(z.string().max(128)).max(100).optional(),
  readOnly: z.boolean().optional(),
  retentionMs: z.number().int().positive().optional(),
}).optional();

export const createEntrySchema = z.object({
  body: z.object({
    name: z.string().min(1).max(256),
    alias: z.string().max(64).optional(),
    order: z.number().int().optional(),
    description: z.string().max(2048).optional(),
    uploadConfig: uploadConfigSchema,
  })
});

export const updateEntrySchema = z.object({
  body: z.object({
    name: z.string().min(1).max(256).optional(),
    alias: z.string().max(64).optional(),
    order: z.number().int().optional(),
    description: z.string().max(2048).optional(),
    uploadConfig: uploadConfigSchema,
  }),
  params: z.object({
    id: objectIdSchema,
  }),
});

export const getEntryByIdSchema = z.object({
  params: z.object({
    id: objectIdSchema,
  }),
});
