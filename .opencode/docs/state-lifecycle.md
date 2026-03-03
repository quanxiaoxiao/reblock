# Entity State Lifecycle

This document defines the complete state lifecycle and transition rules for all entities in the Reblock system.

---

## Table of Contents

1. [Block State Lifecycle](#block-state-lifecycle)
2. [Entry State Lifecycle](#entry-state-lifecycle)
3. [Resource State Lifecycle](#resource-state-lifecycle)
4. [LogEntry State Lifecycle](#logentry-state-lifecycle)
5. [State Transition Matrix](#state-transition-matrix)

---

## Block State Lifecycle

### State Definitions

| State | Description | `isInvalid` | `linkCount` |
|-------|-------------|-------------|-------------|
| `created` | Newly created block | `false` | ≥ 1 |
| `active` | Actively used block | `false` | ≥ 1 |
| `orphaned` | Orphaned block (no references but not deleted) | `false` | 0 |
| `invalidated` | Soft-deleted | `true` | Any |

### State Transition Diagram

```
                    ┌─────────────┐
                    │   created   │
                    └──────┬──────┘
                           │
                           │ Resource references increase
                           ▼
                    ┌─────────────┐
         ┌─────────│   active    │─────────┐
         │         └──────┬──────┘         │
         │                │                  │
         │ References     │ All references   │
         │ decrease       │ removed          │
         ▼                ▼                  │
  ┌─────────────┐  ┌─────────────┐         │
  │   active    │  │  orphaned   │         │
  │ (linkCount  │  │             │         │
  │   changes)  │  │             │         │
  └─────────────┘  └──────┬──────┘         │
         ▲                │                  │
         │                │ Cleanup script   │
         │                ▼ executes         │
         │         ┌─────────────┐         │
         └─────────│ invalidated │◄────────┘
                   └─────────────┘
```

### Transition Rules

| Source State | Target State | Trigger Condition | Action |
|--------------|--------------|-------------------|--------|
| `created` | `active` | Resource references this block on creation | Automatic transition |
| `active` | `active` | Resource reference count changes (increase or decrease) | Update `linkCount` |
| `active` | `orphaned` | Last resource referencing this block is deleted | `linkCount` becomes 0 |
| `orphaned` | `active` | New resource references this orphaned block | `linkCount` increases to ≥ 1 |
| `orphaned` | `invalidated` | Cleanup script executes and retention period exceeded | Soft delete + delete physical file |
| `active` | `invalidated` | Direct soft delete of block (not recommended) | Use with caution, may break resource references |

---

## Entry State Lifecycle

### State Definitions

| State | Description | `isInvalid` | `isDefault` |
|-------|-------------|-------------|-------------|
| `created` | Newly created entry | `false` | `true/false` |
| `active` | Active entry | `false` | `true/false` |
| `default` | Default entry (a type of active) | `false` | `true` |
| `invalidated` | Soft-deleted | `true` | `false` |

### State Transition Diagram

```
                    ┌─────────────┐
                    │   created   │
                    └──────┬──────┘
                           │
                           │ Initialization complete
                           ▼
              ┌─────────────────────────┐
              │         active          │
              │  (isDefault: false)    │
              └───────────┬─────────────┘
                          │
         ┌────────────────┼────────────────┐
         │                │                │
         │ Set as default │ Update config  │ Delete
         ▼                ▼                ▼
┌─────────────┐   ┌─────────────┐  ┌─────────────┐
│   default   │   │   active    │  │ invalidated │
│ (isDefault: │   │ (config     │  └─────────────┘
│    true)    │   │  changed)   │
└──────┬──────┘   └─────────────┘
       │
       │ Unset default
       ▼
┌─────────────┐
│   active    │
└─────────────┘
```

### Transition Rules

| Source State | Target State | Trigger Condition | Action |
|--------------|--------------|-------------------|--------|
| `created` | `active` | Entry creation complete | Automatic transition |
| `active` | `default` | Set `isDefault: true` | Simultaneously unset default status from other entries |
| `default` | `active` | Unset default or set another entry as default | `isDefault` becomes `false` |
| `active` | `invalidated` | Delete entry | Soft delete, keep associated resources |
| `default` | `invalidated` | Delete default entry | Must specify new default entry first |
| `active` | `active` | Update entry config or metadata | State unchanged, only update fields |

---

## Resource State Lifecycle

### State Definitions

| State | Description | `isInvalid` |
|-------|-------------|-------------|
| `created` | Newly created resource | `false` |
| `active` | Active resource | `false` |
| `accessed` | Accessed (a type of active) | `false` |
| `invalidated` | Soft-deleted | `true` |

### State Transition Diagram

```
                    ┌─────────────┐
                    │   created   │
                    └──────┬──────┘
                           │
                           │ Initialization complete
                           ▼
                    ┌─────────────┐
         ┌─────────│   active    │─────────┐
         │         └──────┬──────┘         │
         │                │                  │
         │ Download/      │ Update metadata  │ Delete
         │ Access         │                  │
         ▼                ▼                  ▼
  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
  │  accessed   │  │   active    │  │ invalidated │
  │ (lastAcce-  │  │ (metadata   │  └─────────────┘
  │ ssedAt      │  │  changed)   │
  │  updated)   │  └─────────────┘
  └──────┬──────┘
         │
         │ Continue using
         ▼
  ┌─────────────┐
  │  accessed   │
  │  or active  │
  └─────────────┘
```

### Transition Rules

| Source State | Target State | Trigger Condition | Action |
|--------------|--------------|-------------------|--------|
| `created` | `active` | Resource creation complete | Automatic transition |
| `active` | `accessed` | Resource is downloaded or accessed | Update `lastAccessedAt` |
| `accessed` | `accessed` | Resource accessed again | Update `lastAccessedAt` |
| `active` | `active` | Update resource metadata | State unchanged, update `updatedAt` |
| `accessed` | `active` | Time passes (no action) | Logically still active |
| `active` | `invalidated` | Delete resource | Soft delete, simultaneously decrease block `linkCount` |
| `accessed` | `invalidated` | Delete resource | Soft delete, simultaneously decrease block `linkCount` |

---

## LogEntry State Lifecycle

### State Definitions

| State | Description |
|-------|-------------|
| `open` | Newly discovered issue, pending handling |
| `acknowledged` | Issue acknowledged, being processed |
| `resolved` | Issue resolved |
| `ignored` | Issue ignored (false positive or no action needed) |

### State Transition Diagram

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

### Transition Rules

| Source State | Target State | Trigger Condition | Required Fields |
|--------------|--------------|-------------------|-----------------|
| `open` | `acknowledged` | Issue acknowledged | `statusHistory` record |
| `open` | `resolved` | Issue resolved directly | `resolvedAt`, `resolution`, `resolvedBy` |
| `open` | `ignored` | Issue ignored | `statusHistory` record |
| `acknowledged` | `resolved` | Issue resolution complete | `resolvedAt`, `resolution`, `resolvedBy` |
| `acknowledged` | `ignored` | Decide to ignore after acknowledgment | `statusHistory` record |

**Note**: `resolved` and `ignored` are terminal states and should not transition to other states.

---

## State Transition Matrix

### Block State Transition Matrix

| Source State \\ Target State | `created` | `active` | `orphaned` | `invalidated` |
|------------------------------|-----------|----------|------------|---------------|
| `created`                    | -         | ✅       | ❌         | ❌            |
| `active`                     | ❌        | -        | ✅         | ⚠️ (not recommended) |
| `orphaned`                   | ❌        | ✅       | -          | ✅            |
| `invalidated`                | ❌        | ❌       | ❌         | -             |

### Entry State Transition Matrix

| Source State \\ Target State | `created` | `active` | `default` | `invalidated` |
|------------------------------|-----------|----------|-----------|---------------|
| `created`                    | -         | ✅       | ✅        | ❌            |
| `active`                     | ❌        | -        | ✅        | ✅            |
| `default`                    | ❌        | ✅       | -         | ⚠️ (use with caution) |
| `invalidated`                | ❌        | ❌       | ❌        | -             |

### Resource State Transition Matrix

| Source State \\ Target State | `created` | `active` | `accessed` | `invalidated` |
|------------------------------|-----------|----------|------------|---------------|
| `created`                    | -         | ✅       | ❌         | ❌            |
| `active`                     | ❌        | -        | ✅         | ✅            |
| `accessed`                   | ❌        | ✅       | -          | ✅            |
| `invalidated`                | ❌        | ❌       | ❌         | -             |

### LogEntry State Transition Matrix

| Source State \\ Target State | `open` | `acknowledged` | `resolved` | `ignored` |
|------------------------------|--------|----------------|------------|-----------|
| `open`                       | -      | ✅             | ✅         | ✅        |
| `acknowledged`               | ❌     | -              | ✅         | ✅        |
| `resolved`                   | ❌     | ❌             | -          | ❌        |
| `ignored`                    | ❌     | ❌             | ❌         | -         |

---

## Implementation Checklist

When implementing state management, ensure:

- [ ] All state transitions have clear trigger conditions
- [ ] Record `statusHistory` on state changes (when applicable)
- [ ] Terminal states (`resolved`, `ignored`, `invalidated`) do not transition
- [ ] Timestamp fields are correctly updated (`updatedAt`, `invalidatedAt`, `resolvedAt`)
- [ ] Preconditions are validated during state transitions
- [ ] Exception cases have clear error handling
