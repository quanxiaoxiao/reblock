# LogEntry State Flow Rule

This document defines the complete state flow and transition rules for LogEntry entities in the Reblock system.

---

## Overview

LogEntry tracks the lifecycle of detected issues from discovery through resolution or dismissal. Proper state management ensures issues are tracked consistently and enables auditability.

---

## State Definitions

| State | Description | Final State? |
|-------|-------------|---------------|
| `open` | Newly discovered issue, awaiting triage | ❌ No |
| `acknowledged` | Issue has been reviewed and accepted as valid | ❌ No |
| `resolved` | Issue has been successfully fixed | ✅ Yes |
| `ignored` | Issue has been dismissed (false positive or won't fix) | ✅ Yes |

---

## State Transition Diagram

```
                    ┌─────────────┐
                    │    open     │
                    └──────┬──────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
         │ Acknowledge     │ Resolve directly│ Ignore
         │ issue           │                 │
         ▼                 ▼                 ▼
  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
  │acknowledged │   │  resolved   │   │   ignored   │
  └──────┬──────┘   └─────────────┘   └─────────────┘
         │
         │ Resolve issue
         ▼
  ┌─────────────┐
  │  resolved   │
  └─────────────┘
```

---

## Transition Rules

### From `open` State

| Target State | Trigger Condition | Required Fields | Business Rules |
|--------------|-------------------|-----------------|-----------------|
| `acknowledged` | Issue is reviewed and confirmed valid | `statusHistory` entry with `note`, `changedAt`, `changedBy` | Must provide a note explaining acknowledgment |
| `resolved` | Issue is fixed without acknowledgment phase | `statusHistory`, `resolvedAt`, `resolution`, `resolvedBy` | Must provide resolution details |
| `ignored` | Issue is determined to be a false positive or won't fix | `statusHistory` entry with `note`, `changedAt`, `changedBy` | Must provide a note explaining why it's ignored |

### From `acknowledged` State

| Target State | Trigger Condition | Required Fields | Business Rules |
|--------------|-------------------|-----------------|-----------------|
| `resolved` | Issue has been successfully fixed | `statusHistory`, `resolvedAt`, `resolution`, `resolvedBy` | Must document what was done to resolve |
| `ignored` | After acknowledgment, decide to ignore | `statusHistory` entry with `note`, `changedAt`, `changedBy` | Must explain why it's now being ignored |

### From `resolved` State

| Target State | Allowed? | Reason |
|--------------|----------|--------|
| `open` | ❌ No | Terminal state - issue is resolved |
| `acknowledged` | ❌ No | Terminal state - issue is resolved |
| `ignored` | ❌ No | Terminal state - issue is resolved |

### From `ignored` State

| Target State | Allowed? | Reason |
|--------------|----------|--------|
| `open` | ❌ No | Terminal state - issue is ignored |
| `acknowledged` | ❌ No | Terminal state - issue is ignored |
| `resolved` | ❌ No | Terminal state - issue is ignored |

---

## State Transition Matrix

| Source \\ Target | `open` | `acknowledged` | `resolved` | `ignored` |
|-----------------|--------|----------------|------------|-----------|
| `open`          | -      | ✅             | ✅         | ✅        |
| `acknowledged`  | ❌     | -              | ✅         | ✅        |
| `resolved`      | ❌     | ❌             | -          | ❌        |
| `ignored`       | ❌     | ❌             | ❌         | -         |

---

## statusHistory Field Structure

Every state transition MUST record an entry in the `statusHistory` array:

```typescript
interface StatusHistoryEntry {
  status: string;           // New status: 'open' | 'acknowledged' | 'resolved' | 'ignored'
  changedAt: number;        // Unix timestamp (ms) when status changed
  changedBy?: string;       // Who or what made the change (user ID or system)
  note?: string;            // Explanation of why the status changed
}
```

### Example statusHistory Entries

```javascript
// Acknowledge an issue
{
  status: 'acknowledged',
  changedAt: 1772241136645,
  changedBy: 'admin-user-123',
  note: 'Confirmed this is a valid orphaned block issue'
}

// Resolve an issue
{
  status: 'resolved',
  changedAt: 1772241200000,
  changedBy: 'cleanup-script',
  note: 'Soft deleted via cleanup script'
}

// Ignore an issue
{
  status: 'ignored',
  changedAt: 1772241300000,
  changedBy: 'system',
  note: 'False positive - linkCount was actually correct'
}
```

---

## API Endpoints for State Transitions

### Acknowledge an Issue

```
POST /errors/:id/acknowledge
Content-Type: application/json

{
  "note": "Confirmed issue is valid",
  "changedBy": "user-123"
}

Response: Updated LogEntry
```

**Business Rules:**
- Can only transition from `open` state
- Updates `status` to `acknowledged`
- Adds entry to `statusHistory`
- Updates `updatedAt` timestamp

### Resolve an Issue

```
POST /errors/:id/resolve
Content-Type: application/json

{
  "resolution": "Soft deleted the orphaned block",
  "resolvedBy": "cleanup-script",
  "note": "Cleanup executed successfully"
}

Response: Updated LogEntry
```

**Business Rules:**
- Can transition from `open` or `acknowledged` states
- Updates `status` to `resolved`
- Sets `resolvedAt` to current timestamp
- Sets `resolution` and `resolvedBy` fields
- Adds entry to `statusHistory`
- Updates `updatedAt` timestamp

### Ignore an Issue

```
POST /errors/:id/ignore
Content-Type: application/json

{
  "note": "False positive - data is actually consistent",
  "changedBy": "system"
}

Response: Updated LogEntry
```

**Business Rules:**
- Can transition from `open` or `acknowledged` states
- Updates `status` to `ignored`
- Adds entry to `statusHistory`
- Updates `updatedAt` timestamp

---

## Query Patterns

### Find Open Issues

```typescript
LogEntry.find({
  status: 'open',
  timestamp: { $gte: sinceTimestamp }
}).sort({ timestamp: -1 })
```

### Find Issues Needing Attention

```typescript
LogEntry.find({
  status: { $in: ['open', 'acknowledged'] },
  level: { $in: ['CRITICAL', 'ERROR'] }
}).sort({ level: -1, timestamp: -1 })
```

### Find Recent Resolutions

```typescript
LogEntry.find({
  status: 'resolved',
  resolvedAt: { $gte: sinceTimestamp }
}).sort({ resolvedAt: -1 })
```

---

## Implementation Checklist

When implementing LogEntry state flow:

- [ ] All state transitions validate the source state
- [ ] Terminal states (`resolved`, `ignored`) cannot transition
- [ ] Every state transition adds a `statusHistory` entry
- [ ] `changedAt` is always set to current timestamp
- [ ] `changedBy` identifies the actor (user ID or system)
- [ ] `note` explains the reason for the change
- [ ] `resolvedAt`, `resolution`, and `resolvedBy` are set on resolve
- [ ] `updatedAt` is updated on every state change
- [ ] API endpoints validate state transitions
- [ ] Query patterns use proper indexes
- [ ] TTL index is maintained (90 days expiration)

---

## Error Handling

### Invalid State Transition

When attempting an invalid state transition:

```typescript
throw new Error('Invalid state transition: cannot transition from "resolved" to "open"');
```

**HTTP Response:**
```
Status: 409 Conflict
{
  "error": "Invalid state transition",
  "code": "INVALID_STATE_TRANSITION",
  "details": {
    "currentState": "resolved",
    "attemptedState": "open"
  }
}
```

---

## Business Rules Summary

1. **Open → Acknowledged**: Issue has been validated
2. **Open → Resolved**: Issue is immediately fixed
3. **Open → Ignored**: Issue is dismissed as invalid
4. **Acknowledged → Resolved**: Validated issue has been fixed
5. **Acknowledged → Ignored**: Validated issue is later dismissed
6. **Resolved/Ignored**: Terminal states - no further transitions

All state changes are auditable through the `statusHistory` field.
