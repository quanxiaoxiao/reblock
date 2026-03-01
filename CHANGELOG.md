# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-02-28

### Added

- **Block Storage**: Content-addressable block storage using SHA256 hashing with automatic deduplication
- **Encryption at Rest**: AES-256-CTR encryption for all stored files
- **Streaming Support**: HTTP Range requests for video/audio streaming (RFC 7233)
- **Entry System**: Container system with upload configuration (read-only, MIME type restrictions, file size limits)
- **Resource Management**: Full CRUD operations for resources with soft delete support
- **Logging System**: Dual storage logging (MongoDB + JSON Lines) for anomaly tracking and recovery
- **Doctor Script**: Health diagnostics for detecting data integrity issues
- **Cleanup Script**: Automated cleanup for orphaned blocks and data inconsistencies
- **API Documentation**: OpenAPI 3.0 specification with Scalar UI
- **Docker Support**: Multi-stage Dockerfile with Alpine Linux
- **Test Suite**: Comprehensive testing including unit tests, E2E tests, and integration tests

### Features

- Block deduplication based on SHA256 content hash
- Link count tracking for garbage collection
- HTTP Range request support for partial content streaming
- Client tracking (IP, User-Agent, upload duration) for auditing
- Configurable entry upload settings
- Data integrity verification with Doctor script

### Tech Stack

- [Hono](https://hono.dev/) - Web framework
- [TypeScript](https://www.typescriptlang.org/) - Type-safe JavaScript
- [MongoDB](https://www.mongodb.com/) + [Mongoose](https://mongoosejs.com/) - Database
- [Zod](https://zod.dev/) - Schema validation and OpenAPI docs
- AES-256-CTR - File encryption
- Node.js 24 - Runtime

## [Unreleased]

### Added

### Changed

### Deprecated

### Removed

### Fixed

### Security

---

## Upgrade Notes

### From v0.x to v1.0.0

- This is the first stable release
- MongoDB 4.4+ is required
- Node.js 24+ is required
- An encryption key is required (32-byte, base64 encoded)

## Migration Guides

For future major version upgrades, migration guides will be provided here.

## Known Issues

If you encounter any issues, please check the [GitHub Issues](https://github.com/reblock/reblock/issues) page.
