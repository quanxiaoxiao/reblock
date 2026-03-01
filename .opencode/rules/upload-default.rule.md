# Rule: /upload with no alias

## Overview

The `/upload` endpoint supports two modes:
1. **With alias**: `POST /upload/:alias` - Upload to a specific entry
2. **Without alias**: `POST /upload` - Upload to the default entry

## Behavior

### With Alias

```
POST /upload/my-alias
Content-Type: application/octet-stream
[binary data]
```

- Validates that an entry with the given alias exists
- If not found, returns HTTP 404 with error message "Entry not found"
- Proceeds with normal upload flow

### Without Alias (Default Entry)

```
POST /upload
Content-Type: application/octet-stream
[binary data]
```

- Queries for the default entry: `{ isDefault: true, isInvalid: false }`
- If no default entry exists, returns HTTP 404 with error message "Default entry not found"
- If found, uses that entry's alias for the upload process
- Proceeds with normal upload flow (deduplication, linkCount, etc.)

## Implementation Details

The router extracts the alias from the request:

```typescript
let alias = c.req.param('alias');

// If no alias provided, use default entry
if (!alias) {
  const defaultEntry = await Entry.findOne({ isDefault: true, isInvalid: false });
  if (!defaultEntry) {
    return c.json({ error: 'Default entry not found' }, 404);
  }
  alias = defaultEntry.alias;
}
```

## Error Responses

- **404 - Entry not found**: When alias is provided but entry doesn't exist
- **404 - Default entry not found**: When no alias is provided and no default entry exists
- **400 - Invalid Content-Type**: When Content-Type is not `application/octet-stream`
- **400 - Empty file**: When the uploaded file has no content

## Testing

See `tests/hurl/upload/default-entry.hurl` for test cases covering:
- Upload to default entry (no alias)
- Upload with explicit alias still works
- 404 when no default entry exists
