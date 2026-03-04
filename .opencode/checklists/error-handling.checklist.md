# Error Handling Checklist

## General Principles
- [ ] All errors route through centralized error handler
- [ ] No hardcoded generic error messages (e.g. "Internal server error")
- [ ] Error messages are meaningful and actionable
- [ ] Sensitive details are logged but not exposed to clients

## HTTP Status Codes
- [ ] 4xx errors for client issues with specific descriptions
- [ ] 5xx errors are handled by centralized error handler with appropriate logging
- [ ] Error responses follow standard format with error codes

## Router Layer
- [ ] No direct HTTP responses with generic error messages
- [ ] Business exceptions pass through to error handler
- [ ] Validation errors use standardized format

## Service Layer
- [ ] Business errors have context-aware messages
- [ ] Service layer throws appropriate error types
- [ ] Error information is captured for later logging

## Error Consistency
- [ ] All service error paths go through centralized handler
- [ ] Error IDs are consistent across all layers
- [ ] Request context is maintained in error flows