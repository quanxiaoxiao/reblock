# Hono And Zod

Use Hono for HTTP composition and Zod for API contracts at the request boundary.

## Route Pattern

If the repository already uses `@hono/zod-openapi`:

- use `OpenAPIHono`
- define endpoints with `createRoute`
- keep request and response schemas near the route definition

If the repository uses plain `hono`:

- keep the current router style
- still require Zod schemas for request validation
- only add OpenAPI abstractions when the user explicitly wants that migration

## Validation Contract

Each endpoint should define a schema object using:

- `body?`
- `params?`
- `query?`

Validation should happen before the service call.

Validated data should be attached to context through middleware or an equivalent typed helper, for example:

- `c.set('validated', data)`
- typed request decorators or helper wrappers with the same single-parse behavior

Do not re-parse request data inside services.

## Response Contract

Prefer JSON responses with explicit status codes.

When the repository already documents responses with Zod, keep those response schemas in sync with runtime behavior.

If the repo already uses machine-readable errors, preserve the shape:

```json
{
  "error": "Human-readable message",
  "code": "STABLE_ERROR_CODE"
}
```

For validation failures, return a consistent JSON structure instead of raw thrown errors.

## Router Guardrails

Routers should own:

- request parsing
- validation middleware
- auth middleware wiring
- status code selection
- response shaping

Routers should not own:

- database queries
- business rules
- cross-entity orchestration
- persistence-specific branching

## Minimal Hono Example

```ts
const router = new OpenAPIHono();

router.openapi(routeDefinition, async (c) => {
  const validated = c.get('validated');
  const result = await service.create(validated.body);
  return c.json(result, 201);
});
```

The exact helper names may differ by repository. Preserve local conventions when they already satisfy the same boundary separation.
