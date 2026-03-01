# Rule: Single Default Entry

## Overview

- Only one entry may have `isDefault=true` and `isInvalid!=true` at any time.
- Soft-deleted entries (`isInvalid=true`) are ignored when determining the default entry.

## Database Enforcement

A partial unique index enforces this at the database level:

```javascript
entrySchema.index(
  { isDefault: 1 },
  { unique: true, partialFilterExpression: { isDefault: true, isInvalid: false } }
);
```

This ensures:
1. Only one entry can have `isDefault: true` among non-deleted entries
2. Multiple deleted entries can have `isDefault: true` (they're ignored)
3. The constraint is enforced by MongoDB, not just application logic

## Application Behavior

When setting an entry as default:
- The application should first check if another entry is already the default
- If found, the previous default should be unset (`isDefault: false`)
- Then set the new entry as default

This prevents MongoDB unique index violations.

## Edge Cases

- Marking the default entry as invalid (`isInvalid: true`) automatically excludes it from being the default
- Creating a new entry with `isDefault: true` when one already exists will fail with duplicate key error
- Soft-deleted entries retain their `isDefault` status but are not considered active defaults

## Startup Initialization

On application startup, the system automatically creates a default entry if none exists:

- **Method**: `EntryService.getOrCreateDefault()`
- **Trigger**: After successful MongoDB connection in `app.ts`
- **Default values**:
  - `name`: 'Default'
  - `alias`: 'default'
  - `description`: 'Default entry'
  - `isDefault`: true

### Implementation

```typescript
// EntryService.ts
async getOrCreateDefault(): Promise<IEntry> {
  const existing = await Entry.findOne({ isDefault: true, isInvalid: { $ne: true } });
  if (existing) return existing;

  const entry = new Entry({
    name: 'Default',
    alias: 'default',
    isDefault: true,
    description: 'Default entry',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  try {
    return await entry.save();
  } catch (err: any) {
    if (err.code === 11000) {
      const existing = await Entry.findOne({ isDefault: true, isInvalid: { $ne: true } });
      if (existing) return existing;
    }
    throw err;
  }
}
```

```typescript
// app.ts - after mongoose.connect()
.then(async () => {
  console.log('✅ Connected to MongoDB');
  const defaultEntry = await entryService.getOrCreateDefault();
  console.log(`✅ Default entry ready: ${defaultEntry.alias}`);
})
```

### Why This Approach

1. **Race-condition safe**: Handles concurrent startup attempts
2. **DB constraint respected**: Leverages existing unique index
3. **Transparent**: Upload endpoint works without manual setup
4. **Logging**: Startup confirms default entry status
