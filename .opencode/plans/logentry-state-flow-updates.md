# LogEntry State Flow Rule Updates

## Changes Needed

### Problem
The current `.opencode/rules/logentry-state-flow.rule.md` file contains JavaScript/TypeScript-specific syntax examples that should be replaced with more universal examples.

### Specific Issues
In `logentry-state-flow.rule.md` lines 109-126, there are JavaScript-specific examples:

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

These should be changed to more universal JSON examples without JavaScript type annotations.

## Proposed Solution

Replace the JavaScript-specific syntax with universal JSON notation:

```json
{
  "status": "acknowledged",
  "changedAt": 1772241136645,
  "changedBy": "admin-user-123",
  "note": "Confirmed this is a valid orphaned block issue"
}
```