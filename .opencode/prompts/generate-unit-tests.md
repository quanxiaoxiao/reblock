# Prompt: Generate Unit Tests for Resources Project

## Objective
Automatically generate TypeScript unit test files for the `resources` project, covering:

1. **Service Layer**: blockService, entryService, resourceService, uploadService  
   - CRUD operations, business rules, timestamps, soft delete, pagination, file handling  
   - Error handling for invalid input or DB errors  

2. **Router Layer**: blockRouter, entryRouter, resourceRouter, uploadRouter  
   - Endpoint coverage: GET, POST, PUT, DELETE, file download/upload  
   - Response validation: status codes, JSON structure, headers  
   - Query/path params and error paths  

3. **Schema Validation**: blockSchema, entrySchema, resourceSchema  
   - Valid and invalid inputs  
   - Optional fields handling  
   - Path/body param validation for routers  

4. **App Layer / OpenAPI**: app.ts  
   - Health check endpoint `/health`  
   - OpenAPI JSON `/openapi.json`  
   - Swagger UI `/docs`  

---

## Rules for Test Generation

### 1. Service Layer
- Use `vitest` for tests  
- Mock dependent models (`mongoose` or other DB layer)  
- Include `describe` and `it` blocks for:
  - `create`, `getById`, `list`, `update`, `delete`  
  - Soft delete (`isInvalid`, `invalidatedAt`)  
  - Business rules (alias uniqueness, single default entry)  
  - File upload/download handling  
  - Pagination, error handling  
- Include setup/teardown hooks (`beforeEach`, `afterEach`) for mocks  

### 2. Router Layer
- Use `supertest` or Hono test utilities  
- Mock service layer methods  
- Include tests for:
  - All endpoints (GET, POST, PUT, DELETE)  
  - Error paths (404, 409, 500)  
  - Query/path parameters  
  - Content-Type and headers validation  
  - File uploads/downloads with in-memory files  

### 3. Schema Validation
- Directly call `zod` validators  
- Test valid and invalid input  
- Edge cases: missing fields, wrong types, empty strings  

### 4. App / OpenAPI
- Test `/health` returns 200 + JSON `{ status: 'ok' }`  
- Test `/openapi.json` returns valid OpenAPI spec  
- Test `/docs` returns HTML content  
- Mock MongoDB connection for isolation  

### 5. Test File Naming
- `*.service.test.ts` → service layer  
- `*.router.test.ts` → router layer  
- `*.schema.test.ts` → schema validation  
- `app.test.ts` → app / OpenAPI / health  

### 6. Mocking & Isolation
- Services: mock mongoose models  
- Routers: mock services  
- File uploads: use in-memory temp files  
- Download: mock `createReadStream`  

### 7. Output Format
- TypeScript + Vitest syntax  
- Include meaningful `describe` / `it` titles  
- Include setup/teardown for mocks  
- Include example assertions for success/error scenarios  

---

## Instruction for Opencode
1. Detect all files under `src/services`, `src/routes`, `src/schemas`, `src/app.ts`  
2. For each file, generate a corresponding `.test.ts` with:
   - Setup/teardown hooks  
   - Mocked dependencies  
   - All main public methods/endpoints  
   - Example test cases for success & error paths  
3. Organize generated test files in parallel folder structure `tests/unit`  
4. Ensure high coverage of business logic and input validation

