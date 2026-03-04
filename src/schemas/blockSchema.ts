import { z } from 'zod';

/** Reusable ObjectId validator: 24-character hex string */
export const objectIdSchema = z.string().regex(/^[a-f0-9]{24}$/, 'Must be a valid 24-char hex ObjectId');

/** Reusable SHA256 validator: exactly 64-character lowercase hex string */
export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, 'Must be a valid 64-char hex SHA256 hash');

export const createBlockSchema = z.object({
  body: z.object({
    sha256: sha256Schema,
    linkCount: z.number().int().nonnegative().optional(),
    size: z.number().int().nonnegative().optional(),
  })
});

export const updateBlockSchema = z.object({
  body: z.object({
    // sha256 is intentionally excluded — content hash must not be mutated via API
    linkCount: z.number().int().nonnegative().optional(),
    size: z.number().int().nonnegative().optional(),
  }),
  params: z.object({
    id: objectIdSchema,
  }),
});

export const getBlockByIdSchema = z.object({
  params: z.object({
    id: objectIdSchema,
  }),
});
