# TypeScript Project Directory Layout

This document defines the recommended directory structure for TypeScript implementations of the Reblock service.

---

## Standard Directory Structure

```
project-root/
├── src/
│   ├── app.ts                 # Application entry point
│   ├── server.ts              # Server startup
│   │
│   ├── config/                # Configuration
│   │   └── env.ts            # Environment variables
│   │
│   ├── middleware/            # HTTP middleware
│   │   └── audit.ts          # Audit logging middleware
│   │
│   ├── models/                # Data models (persistence layer only)
│   │   ├── index.ts          # Model exports
│   │   └── logEntry.ts       # LogEntry model
│   │
│   ├── routes/                # API routes
│   │   ├── blockRouter.ts
│   │   ├── entryRouter.ts
│   │   ├── resourceRouter.ts
│   │   ├── uploadRouter.ts
│   │   ├── errorRouter.ts
│   │   ├── migrationRouter.ts
│   │   ├── metricsRouter.ts
│   │   ├── legacyRouter.ts
│   │   └── middlewares/
│   │       ├── errorHandler.ts
│   │       └── requestCapture.ts
│   │
│   ├── schemas/               # Validation schemas (Zod)
│   │
│   ├── services/              # Business logic layer
│   │   ├── index.ts          # Service singleton exports
│   │   ├── blockService.ts
│   │   ├── entryService.ts
│   │   ├── resourceService.ts
│   │   ├── uploadService.ts
│   │   ├── logService.ts
│   │   ├── auditService.ts
│   │   ├── migrationService.ts
│   │   ├── metricsSnapshotService.ts
│   │   └── types.ts          # Shared service types
│   │
│   ├── types/                 # Type definitions
│   │
│   └── utils/                 # Utility functions
│       └── crypto.ts         # Encryption/decryption utilities
│
├── scripts/                   # CLI scripts
│
├── tests/                     # Tests
│   ├── unit/                 # Unit tests
│   └── hurl/                 # Hurl integration tests
│
├── storage/                   # Data storage
│   ├── _logs/               # Log files
│   ├── blocks/              # Encrypted block storage
│   └── temp/                # Temporary upload storage
│
├── dist/                      # Compiled output
├── coverage/                  # Test coverage reports
├── node_modules/              # Dependencies
│
├── package.json
├── tsconfig.json
├── eslint.config.mjs
├── vitest.config.ts
├── nodemon.json
├── .env.example
├── .gitignore
├── Dockerfile
├── docker-compose.yml
├── README.md
├── AGENTS.md
├── CHANGELOG.md
└── CONTRIBUTING.md
```

---

## Directory Responsibilities

### src/
Source code directory, containing all application code.

### src/config/
Environment configuration and settings.

### src/middleware/
Hono middleware for cross-cutting concerns.

### src/models/
Data models and persistence layer only. No business logic.

### src/routes/
API route definitions and request handlers. No business logic, only HTTP mapping.

### src/schemas/
Zod validation schemas for API contract definition.

### src/services/
Business logic layer. All business rules live here.

### src/types/
TypeScript type definitions shared across the application.

### src/utils/
Utility functions and helpers.

### scripts/
CLI scripts for maintenance, diagnostics, and operations.

### tests/
Test files, both unit tests and Hurl integration tests.

### storage/
Data storage for logs, encrypted blocks, and temporary files.

---

## Layer Architecture

The project follows strict layered architecture:

```
routes → schemas → services → models
```

1. **Routes**: HTTP mapping only
2. **Schemas**: Validation and API contract
3. **Services**: Business logic
4. **Models**: Persistence only

---

## File Naming Conventions

See [file-naming.md](./file-naming.md) for detailed file naming conventions.
