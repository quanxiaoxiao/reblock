# Rule: Unit Tests Generation for Resources Project

## Purpose
Automatically generate unit tests for the `resources` project, covering:
- Service layer (blockService, entryService, resourceService, uploadService)
- Router layer (blockRouter, entryRouter, resourceRouter, uploadRouter)
- Schema validation (blockSchema, entrySchema, resourceSchema)
- Health check and OpenAPI endpoints (app.ts)

Tests should validate functionality, error handling, edge cases, and business rules.

---

## Targets
- `src/services/*.ts`
- `src/routes/*.ts`
- `src/schemas/*.ts`
- `src/app.ts`

---

## Testing Guidelines

### 1. Service Layer Tests
**Files:** `blockService.ts`, `entryService.ts`, `resourceService.ts`, `uploadService.ts`

**Focus Areas:**
1. CRUD operations
   - create, getById, list, update, delete
   - validate `isInvalid` soft-delete logic
   - verify timestamps (`createdAt`, `updatedAt`, `invalidatedAt`)
2. Business rules
   - entryService: alias uniqueness, single default entry
   - uploadService: invalid alias, empty file handling
3. Error handling
   - throw appropriate errors for business violations
   - simulate DB errors (optional: mock mongoose methods)
4. Pagination behavior
   - limit/offset handling
   - stable ordering
5. File uploads/downloads
   - temp file creation
   - stream handling
   - cleanup on error

**Test Tools:**
- `vitest` or `jest`
- `sinon` or built-in mocks for mongoose

**Example Scenarios:**
- BlockService: `delete(id)` marks `isInvalid` true and sets `invalidatedAt`
- EntryService: `create({ alias })` throws BusinessError if duplicate
- ResourceService: `download(id)` returns ReadableStream
- UploadService: rejects empty file or invalid alias

---

### 2. Router Layer Tests
**Files:** `blockRouter.ts`, `entryRouter.ts`, `resourceRouter.ts`, `uploadRouter.ts`

**Focus Areas:**
1. Endpoint coverage
   - GET, POST, PUT, DELETE
   - Download and file upload endpoints
2. Response validation
   - Correct HTTP status codes (200, 201, 204, 404, 409, 500)
   - JSON body structure according to schema
3. Error simulation
   - Mock service layer to throw errors
   - Validate router translates errors into proper HTTP responses
4. Query & path params handling
   - Pagination, entryAlias filters, inline download option
5. Content-Type enforcement
   - Upload endpoint requires `application/octet-stream`

**Test Tools:**
- `supertest` or Hono test utilities
- Service layer mocks

**Example Scenarios:**
- GET `/entries/:id` returns 404 when entry not found
- POST `/upload/:alias` rejects empty file
- GET `/resources/:id/download?inline=true` returns correct `Content-Disposition`

---

### 3. Schema Validation Tests
**Files:** `schemas/*.ts`

**Focus Areas:**
1. Validate correct input passes
2. Reject invalid/missing fields
3. Optional fields handled correctly
4. Ensure path & body params required for routers

**Test Tools:**
- Direct `zod` validation calls
- Edge cases: missing required fields, wrong types, empty strings

---

### 4. App & OpenAPI Tests
**Files:** `app.ts`, `server.ts`

**Focus Areas:**
1. Health endpoint `/health` returns 200 + valid JSON
2. OpenAPI JSON generation `/openapi.json` returns valid spec
3. Swagger UI `/docs` returns HTML
4. MongoDB connection mocked for tests

**Test Tools:**
- `supertest` or Hono testing utilities
- Mock `mongoose.connect`

---

### 5. Test File Naming Convention
- `*.service.test.ts` → service layer
- `*.router.test.ts` → router layer
- `*.schema.test.ts` → schema validation
- `app.test.ts` → app / OpenAPI / health check

---

### 6. Mocking & Isolation
- Services: mock dependent models (mongoose)
- Routers: mock services
- File uploads: use in-memory temp files (`memfs` or temp dir)
- Download: mock `createReadStream` to avoid real file I/O

---

### 7. Expected Coverage
- 100% coverage of public methods in service classes
- 95% coverage of routers (all routes & error paths)
- Schema: all input validation paths

---

### 8. Output Format
- Generate test file for each target file
- Use TypeScript + Vitest syntax
- Include `describe`, `it` blocks with meaningful titles
- Include setup/teardown for mocks

