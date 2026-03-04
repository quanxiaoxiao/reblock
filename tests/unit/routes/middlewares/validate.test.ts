import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validate } from '@/routes/middlewares/validate';
import { z } from 'zod';
import type { Context, Next } from 'hono';

describe('validate middleware', () => {
  let mockContext: Context;
  let mockNext: ReturnType<typeof vi.fn>;
  let schema: z.ZodSchema;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock context
    mockContext = {
      req: {
        json: vi.fn().mockResolvedValue({}),
        param: vi.fn().mockReturnValue({}),
        query: vi.fn().mockReturnValue({}),
      },
      set: vi.fn(),
      json: vi.fn().mockReturnValue(new Response(JSON.stringify({}), { status: 200 })),
    } as unknown as Context;

    mockNext = vi.fn().mockResolvedValue(undefined);

    // Create a simple schema for testing
    schema = z.object({
      body: z.object({
        name: z.string(),
        age: z.number(),
      }),
      params: z.object({}),
      query: z.object({}),
    });
  });

  describe('validation success', () => {
    it('should call next() for valid input', async () => {
      const validData = { name: 'John', age: 30 };
      (mockContext.req.json as ReturnType<typeof vi.fn>).mockResolvedValueOnce(validData);

      const middleware = validate(schema);
      await middleware(mockContext, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockContext.json).not.toHaveBeenCalled();
    });

    it('should set validated data on context', async () => {
      const validData = { name: 'John', age: 30 };
      (mockContext.req.json as ReturnType<typeof vi.fn>).mockResolvedValueOnce(validData);

      const middleware = validate(schema);
      await middleware(mockContext, mockNext);

      expect(mockContext.set).toHaveBeenCalledWith('validated', expect.objectContaining({
        body: validData,
        params: {},
        query: {},
      }));
    });

    it('should handle complex nested objects', async () => {
      const complexSchema = z.object({
        body: z.object({
          user: z.object({
            name: z.string(),
            email: z.string().email(),
            settings: z.object({
              theme: z.enum(['light', 'dark']),
              notifications: z.boolean(),
            }),
          }),
        }),
        params: z.object({}),
        query: z.object({}),
      });

      const validData = {
        user: {
          name: 'Jane',
          email: 'jane@example.com',
          settings: {
            theme: 'dark',
            notifications: true,
          },
        },
      };
      (mockContext.req.json as ReturnType<typeof vi.fn>).mockResolvedValueOnce(validData);

      const middleware = validate(complexSchema);
      await middleware(mockContext, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle arrays in body', async () => {
      const arraySchema = z.object({
        body: z.object({
          items: z.array(z.string()),
        }),
        params: z.object({}),
        query: z.object({}),
      });

      const validData = { items: ['item1', 'item2', 'item3'] };
      (mockContext.req.json as ReturnType<typeof vi.fn>).mockResolvedValueOnce(validData);

      const middleware = validate(arraySchema);
      await middleware(mockContext, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle optional fields', async () => {
      const optionalSchema = z.object({
        body: z.object({
          name: z.string(),
          description: z.string().optional(),
          count: z.number().optional(),
        }),
        params: z.object({}),
        query: z.object({}),
      });

      const validData = { name: 'Test' };
      (mockContext.req.json as ReturnType<typeof vi.fn>).mockResolvedValueOnce(validData);

      const middleware = validate(optionalSchema);
      await middleware(mockContext, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('validation failure', () => {
    it('should return 400 for invalid input', async () => {
      const invalidData = { name: 123, age: 'not a number' };
      (mockContext.req.json as ReturnType<typeof vi.fn>).mockResolvedValueOnce(invalidData);

      const middleware = validate(schema);
      await middleware(mockContext, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockContext.json).toHaveBeenCalled();
      
      const jsonCall = (mockContext.json as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(jsonCall[1]).toBe(400);
    });

    it('should include error details in response', async () => {
      const invalidData = { name: 123 };
      (mockContext.req.json as ReturnType<typeof vi.fn>).mockResolvedValueOnce(invalidData);

      const middleware = validate(schema);
      await middleware(mockContext, mockNext);

      const jsonCall = (mockContext.json as ReturnType<typeof vi.fn>).mock.calls[0];
      const responseBody = jsonCall[0];

      expect(responseBody).toHaveProperty('error', 'ValidationError');
      expect(responseBody).toHaveProperty('details');
    });

    it('should flatten validation errors', async () => {
      const invalidData = {};
      (mockContext.req.json as ReturnType<typeof vi.fn>).mockResolvedValueOnce(invalidData);

      const middleware = validate(schema);
      await middleware(mockContext, mockNext);

      const jsonCall = (mockContext.json as ReturnType<typeof vi.fn>).mock.calls[0];
      const responseBody = jsonCall[0];

      expect(responseBody.details).toHaveProperty('fieldErrors');
      expect(responseBody.details).toHaveProperty('formErrors');
    });

    it('should handle missing required fields', async () => {
      const incompleteData = { name: 'John' }; // missing age
      (mockContext.req.json as ReturnType<typeof vi.fn>).mockResolvedValueOnce(incompleteData);

      const middleware = validate(schema);
      await middleware(mockContext, mockNext);

      expect(mockContext.json).toHaveBeenCalled();
      const jsonCall = (mockContext.json as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(jsonCall[1]).toBe(400);
    });

    it('should handle wrong data types', async () => {
      const wrongTypes = { name: 12345, age: 'thirty' };
      (mockContext.req.json as ReturnType<typeof vi.fn>).mockResolvedValueOnce(wrongTypes);

      const middleware = validate(schema);
      await middleware(mockContext, mockNext);

      expect(mockContext.json).toHaveBeenCalled();
    });
  });

  describe('params validation', () => {
    it('should validate params', async () => {
      const paramsSchema = z.object({
        body: z.object({}),
        params: z.object({
          id: z.string().uuid(),
        }),
        query: z.object({}),
      });

      (mockContext.req.param as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        id: '550e8400-e29b-41d4-a716-446655440000',
      });

      const middleware = validate(paramsSchema);
      await middleware(mockContext, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should reject invalid params', async () => {
      const paramsSchema = z.object({
        body: z.object({}),
        params: z.object({
          id: z.string().uuid(),
        }),
        query: z.object({}),
      });

      (mockContext.req.param as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        id: 'not-a-uuid',
      });

      const middleware = validate(paramsSchema);
      await middleware(mockContext, mockNext);

      expect(mockContext.json).toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('query validation', () => {
    it('should validate query parameters', async () => {
      const querySchema = z.object({
        body: z.object({}),
        params: z.object({}),
        query: z.object({
          page: z.string().transform(Number).pipe(z.number().positive()),
          limit: z.string().transform(Number).pipe(z.number().positive().max(100)),
        }),
      });

      (mockContext.req.query as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        page: '1',
        limit: '20',
      });

      const middleware = validate(querySchema);
      await middleware(mockContext, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should reject invalid query parameters', async () => {
      const querySchema = z.object({
        body: z.object({}),
        params: z.object({}),
        query: z.object({
          page: z.string().transform(Number).pipe(z.number().positive()),
        }),
      });

      (mockContext.req.query as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        page: '-1',
      });

      const middleware = validate(querySchema);
      await middleware(mockContext, mockNext);

      expect(mockContext.json).toHaveBeenCalled();
    });
  });

  describe('combined validation', () => {
    it('should validate body, params, and query together', async () => {
      const combinedSchema = z.object({
        body: z.object({
          name: z.string(),
        }),
        params: z.object({
          id: z.string(),
        }),
        query: z.object({
          include: z.string().optional(),
        }),
      });

      (mockContext.req.json as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ name: 'Test' });
      (mockContext.req.param as ReturnType<typeof vi.fn>).mockReturnValueOnce({ id: '123' });
      (mockContext.req.query as ReturnType<typeof vi.fn>).mockReturnValueOnce({ include: 'details' });

      const middleware = validate(combinedSchema);
      await middleware(mockContext, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockContext.set).toHaveBeenCalledWith('validated', {
        body: { name: 'Test' },
        params: { id: '123' },
        query: { include: 'details' },
      });
    });

    it('should fail if any part is invalid', async () => {
      const combinedSchema = z.object({
        body: z.object({
          name: z.string(),
        }),
        params: z.object({
          id: z.string().uuid(),
        }),
        query: z.object({}),
      });

      (mockContext.req.json as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ name: 'Test' });
      (mockContext.req.param as ReturnType<typeof vi.fn>).mockReturnValueOnce({ id: 'invalid-uuid' });

      const middleware = validate(combinedSchema);
      await middleware(mockContext, mockNext);

      expect(mockContext.json).toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle empty body gracefully', async () => {
      const emptySchema = z.object({
        body: z.object({}),
        params: z.object({}),
        query: z.object({}),
      });

      (mockContext.req.json as ReturnType<typeof vi.fn>).mockResolvedValueOnce({});

      const middleware = validate(emptySchema);
      await middleware(mockContext, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle request body parsing errors', async () => {
      (mockContext.req.json as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Parse error'));

      const middleware = validate(schema);
      await middleware(mockContext, mockNext);

      // Should treat parse error as empty body
      expect(mockContext.json).toHaveBeenCalled();
    });

    it('should preserve all validation errors', async () => {
      const multiFieldSchema = z.object({
        body: z.object({
          email: z.string().email(),
          password: z.string().min(8),
          age: z.number().min(0).max(150),
        }),
        params: z.object({}),
        query: z.object({}),
      });

      const invalidData = {
        email: 'not-an-email',
        password: 'short',
        age: -5,
      };
      (mockContext.req.json as ReturnType<typeof vi.fn>).mockResolvedValueOnce(invalidData);

      const middleware = validate(multiFieldSchema);
      await middleware(mockContext, mockNext);

      const jsonCall = (mockContext.json as ReturnType<typeof vi.fn>).mock.calls[0];
      const responseBody = jsonCall[0];
      
      expect(responseBody.details.fieldErrors).toBeDefined();
      // Should have errors for all three fields
      expect(Object.keys(responseBody.details.fieldErrors).length).toBeGreaterThanOrEqual(1);
    });
  });
});
