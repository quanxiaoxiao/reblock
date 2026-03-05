# Maintenance Hurl Tests

This directory contains maintenance-oriented integration tests.

## Entry retention cleanup

`retention-scheduler.hurl` verifies:
- `uploadConfig.retentionMs` can drive expiration behavior
- internal retention scheduler removes expired resources
- expired resources become `404` via normal resource visibility checks

Current status: green validation in default `npm run test:hurl`.
