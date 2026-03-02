# Reblock

[![npm version](https://img.shields.io/npm/v/reblock.svg)](https://www.npmjs.com/package/reblock)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/node/v/reblock.svg)](https://nodejs.org)
[![Docker Pulls](https://img.shields.io/docker/pulls/reblock/reblock.svg)](https://hub.docker.com/r/reblock/reblock)
[![Test Status](https://github.com/reblock/reblock/actions/workflows/ci.yml/badge.svg)](https://github.com/reblock/reblock/actions)
[![Coverage Status](https://codecov.io/gh/reblock/reblock/branch/main/graph/badge.svg)](https://codecov.io/gh/reblock/reblock)

> Resource Block - Block Storage and Streaming Media Service

A high-performance resource storage service built with Hono + TypeScript, featuring block-based deduplicated storage, encryption, streaming media support, and HTTP Range requests.

## Features

- **Block Storage** - Files stored as content-addressable blocks using SHA256 hashing with automatic deduplication
- **Encryption at Rest** - AES-256-CTR encryption for all stored files
- **Streaming Support** - HTTP Range requests for video/audio streaming (RFC 7233)
- **High Performance** - Built on Hono framework for lightweight, fast performance
- **OpenAPI Documentation** - Auto-generated API docs with Scalar UI
- **Comprehensive Logging** - Dual storage (MongoDB + JSON Lines) for anomaly tracking and recovery

## Tech Stack

- [Hono](https://hono.dev/) - Fast, lightweight web framework
- [TypeScript](https://www.typescriptlang.org/) - Type-safe JavaScript
- [MongoDB](https://www.mongodb.com/) + [Mongoose](https://mongoosejs.com/) - Database
- [Zod](https://zod.dev/) - Schema validation and OpenAPI docs
- AES-256-CTR - File encryption
- Node.js 24 - Runtime

## Quick Start

### Prerequisites

- Node.js 24+
- MongoDB 4.4+
- Base64-encoded 32-byte encryption key

### Option 1: Docker Compose (Recommended)

```bash
# 1. Generate encryption key
echo "ENCRYPTION_KEY=$(openssl rand -base64 32)" > .env

# 2. Start services
docker-compose up -d

# 3. Visit http://localhost:3000/docs for API documentation
```

### Option 2: Manual Setup

```bash
npm install
```

### Configuration

```bash
cp .env.example .env
# Edit .env with your configuration
```

### Development

```bash
npm run dev
```

### Production

```bash
npm run build
npm start
```

## API Reference

### Health Check

```
GET /health
```

### Documentation (Development)

- OpenAPI spec: `GET /openapi.json`
- Scalar UI: `GET /docs`

### Entries

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/entries` | Create entry |
| GET | `/entries` | List entries |
| GET | `/entries/:id` | Get entry |
| PUT | `/entries/:id` | Update entry |
| DELETE | `/entries/:id` | Delete entry (cascades to resources) |

**Upload Configuration**:
```json
{
  "name": "Photos",
  "alias": "photos",
  "uploadConfig": {
    "readOnly": false,
    "maxFileSize": 10485760,
    "allowedMimeTypes": ["image/*", "video/mp4"]
  }
}
```

### Resources

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/resources` | List resources (paginated) |
| GET | `/resources/:id` | Get resource |
| PUT | `/resources/:id` | Update resource |
| PATCH | `/resources/:id/block` | Atomically switch resource to another block (resource ID unchanged) |
| GET | `/resources/:id/history` | Query block change history for a resource |
| POST | `/resources/:id/rollback` | Rollback block binding by history ID |
| DELETE | `/resources/:id` | Delete resource |
| GET | `/resources/:id/download` | Download (supports Range requests) |

**Query Parameters**:
- `?inline=true` - Display inline for video/audio
- `Range: bytes=start-end` - Partial content

**Response Fields**:
Resource responses include client tracking metadata (IP, User-Agent, upload duration) for auditing and analytics.

### Upload

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/upload` | Upload to default entry |
| POST | `/upload/:alias` | Upload to specific entry |

## Project Structure

```
src/
├── app.ts              # App setup and routes
├── server.ts           # Server startup
├── config/             # Configuration
├── middleware/         # Middleware
├── models/             # Data models
├── routes/             # API routes
├── services/           # Business logic
├── utils/              # Utilities
scripts/                # CLI scripts
tests/                  # Test files
storage/                # Data storage
```

## Scripts

### Development

```bash
npm run build           # Compile TypeScript
npm run dev             # Development with hot reload
npm run typecheck       # Type check
```

### Testing

```bash
npm run test            # Unit tests
npm run test:e2e        # End-to-end tests
npm run test:hurl       # Hurl integration tests (auto build + auto start server on TEST_PORT, default 4362)
npm run test:mp4        # MP4 streaming tests
```

### Maintenance

```bash
npm run doctor          # Health check
npm run cleanup         # Clean up orphaned data
npm run logs:analyze    # Analyze logs
npm run errors:fetch    # Query runtime 500 errors
npm run errors:repro    # Generate hurl from latest open 500 error
npm run errors:resolve  # Mark error as resolved
```

### Doctor Script

Detects data integrity issues:
- LinkCount mismatches
- Orphaned blocks
- Missing files
- Duplicate SHA256 hashes

```bash
npm run doctor                        # Check all blocks
npm run doctor -- --issues-only       # Show only issues
npm run doctor -- --json              # JSON output
```

### Cleanup Script

```bash
npm run cleanup -- --preview          # Preview cleanup
npm run cleanup -- --execute          # Execute (with confirmation)
npm run cleanup -- --days 7           # Override threshold
```

### Log Analysis

```bash
npm run logs:analyze                  # Last 7 days
npm run logs:analyze -- --days 30     # Last 30 days
npm run logs:analyze -- --category MISSING_FILE
```

### 500 Error Debug Loop

Recommended closed-loop for server-side 500 issues:

```bash
# 1) Detect open runtime 500 errors
npm run errors:fetch -- --days 1 --status open

# 2) Generate reproducible hurl from latest open error
npm run errors:repro

# 3) Or generate and run immediately
npm run errors:repro -- --run

# 4) Fix code, then rerun generated hurl
hurl tests/hurl/errors/generated/repro-<error_id>.hurl --variable BASE_URL=http://localhost:4362

# 5) If you have request id, narrow scope quickly
curl -H "x-errors-token: <errors_api_token>" \
  "http://localhost:4362/errors?days=1&status=open&requestId=<request_id>"

# 6) Mark resolved after verification
npm run errors:resolve -- --id <error_id> --resolution "Root cause fixed"
```

`errors:repro` uses `/errors` + `/errors/:id/export` to produce a replayable hurl case.

You can use `tests/hurl/errors/request-id-correlation.hurl` as a template to verify `X-Request-Id` => `/errors` => `/errors/:id` linkage.

## Configuration

### Environment Variables

```bash
# Server
NODE_ENV=development
PORT=3000

# MongoDB
MONGO_HOSTNAME=localhost
MONGO_PORT=27017
MONGO_DATABASE=reblock
# MONGO_USERNAME=admin
# MONGO_PASSWORD=secret

# Storage
STORAGE_TEMP_DIR=./storage/_temp
STORAGE_BLOCK_DIR=./storage/blocks
STORAGE_LOG_DIR=./storage/_logs

# Security (Required)
ENCRYPTION_KEY=your_base64_key_here

# Cleanup
CLEANUP_DEFAULT_DAYS=30
LOG_TTL_DAYS=90
LOG_ARCHIVE_DAYS=30
LOG_ARCHIVE_TZ=Asia/Shanghai
LOG_DEDUP_WINDOW_MINUTES=10
ERROR_FALLBACK_LOG_FILE=./storage/_logs/runtime-fallback.log

# Error API protection (optional)
# If set, all /errors endpoints require x-errors-token
ERRORS_API_TOKEN=your-errors-token
```

## Data Model

### Block
- **SHA256** - Content hash (unique)
- **linkCount** - Reference count
- **size** - File size
- **Encrypted storage** - AES-256-CTR

### Resource
- References a Block
- Metadata: name, MIME type, entry
- **Client Tracking**: IP address, User-Agent, upload duration
- Soft delete support

**Resource Block Switch and History**:
- Resource ID stays stable while block binding can change (`PATCH /resources/:id/block`)
- Block switch runs in MongoDB transaction (resource update + linkCount updates + history insert)
- Every switch writes an immutable history record
- Rollback is supported through history (`POST /resources/:id/rollback`)
- History query endpoint: `GET /resources/:id/history`
- Rollback writes audit action logs before/after execution; failures are logged as `RUNTIME_ERROR` and discoverable via `/errors`

**Resource Client Tracking**:
Resources now track upload metadata for auditing and analytics:
- `clientIp` - Client IP address (supports X-Forwarded-For, Cloudflare)
- `userAgent` - Client browser/agent string
- `uploadDuration` - Upload time in milliseconds

This enables security auditing, usage analytics, and performance monitoring.

### Entry
- Container for resources
- Upload configuration
- Alias for friendly URLs

## Logging System

Comprehensive logging with dual storage:

**MongoDB** - Queryable, 90-day TTL
**Files** - `storage/_logs/issues/YYYY-MM-DD.jsonl`

Log categories:
- `ORPHANED_BLOCK` - Blocks with no references
- `MISSING_FILE` - Physical file missing
- `DUPLICATE_SHA256` - Hash collisions
- `LINKCOUNT_MISMATCH` - Reference count errors
- `CLEANUP_ACTION` - Cleanup operations

## Docker

### Docker Compose (Recommended)

The easiest way to get started:

```bash
# Generate encryption key and optional timezone
echo "ENCRYPTION_KEY=$(openssl rand -base64 32)" > .env
echo "TZ=Asia/Shanghai" >> .env   # optional

# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

### Docker Build

Multi-stage build with Alpine Linux:

```bash
# Standard build
docker build --build-arg TZ=${TZ:-Asia/Shanghai} -t reblock .
docker run -p 3000:3000 --env-file .env -e TZ=${TZ:-Asia/Shanghai} reblock
```

**Build Arguments:**

| Argument | Default | Description |
|----------|---------|-------------|
| `TZ` | `Asia/Shanghai` | Container timezone |
| `USE_CN_MIRROR` | `false` | Use China npm mirror (npmmirror.com) for faster builds in China |

```bash
# Build for China network (faster npm install)
docker build --build-arg USE_CN_MIRROR=true -t reblock .
```

Features:
- Non-root user
- Health check
- ~100MB image size

Timezone configuration:
- Default timezone is `Asia/Shanghai`.
- Override with `.env` (`TZ=UTC`) when using Docker Compose.
- Override with `--build-arg TZ=...` (build time) and `-e TZ=...` (runtime) when using `docker build/run`.

## Testing

### Unit Tests (Vitest)
```bash
npm run test
npm run test:coverage
```

### E2E Tests
Comprehensive testing including:
- Entry creation with restrictions
- File upload and deduplication
- Block linkCount validation
- Delete and 404 verification
- Doctor health checks
- Log integrity

```bash
npm run test:e2e
npm run test:e2e -- --keep-data
```

## Streaming Example

Browser video playback:

```html
<video controls>
  <source src="http://localhost:3000/resources/{id}/download?inline=true" 
          type="video/mp4">
</video>
```

Or download:
```bash
curl -O http://localhost:3000/resources/{id}/download
```

## Scripts Generation Rules

All scripts follow standardized patterns defined in `.opencode/rules/scripts-generation.rule.md`:
- Load environment from `.env`
- Support PORT/SERVER_PORT configuration
- MongoDB connection from environment
- Storage paths from environment variables

## License

MIT

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details.

## Related

- [CHANGELOG](CHANGELOG.md) - Version history
- [CONTRIBUTING](CONTRIBUTING.md) - Contribution guidelines
