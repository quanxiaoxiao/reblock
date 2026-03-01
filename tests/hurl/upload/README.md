# Upload API Hurl Tests

## Test Files

| File | Purpose |
|------|---------|
| `create.hurl` | Basic upload creation with binary data |
| `dedupe.hurl` | Block deduplication - same content reuses block and increments linkCount |
| `validation.hurl` | Input validation: empty body, wrong content-type, non-existing entry |
| `lifecycle.hurl` | Resource deletion decrements linkCount, linkCount=0 behavior |
| `cleanup.hurl` | Deleted entry behavior - upload to soft-deleted entry returns 404 |

## Test Data

- `test-data.bin` - Binary test file (14 bytes)

## Run Tests

```bash
# Run all upload tests
hurl tests/hurl/upload/*.hurl --variable BASE_URL=http://localhost:3000

# Run specific test
hurl tests/hurl/upload/validation.hurl --variable BASE_URL=http://localhost:3000
```

## Architecture Compliance

These tests enforce:

- ✅ Layered architecture (router → service → model)
- ✅ Soft-delete awareness (`isInvalid: { $ne: true }`)
- ✅ Timestamp ownership (service-injected, not user-controlled)
- ✅ Block deduplication by SHA256
- ✅ linkCount invariant management
