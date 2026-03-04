# Overload Protection and Request Hang Mitigation

This document describes the server-side overload protection mechanism for heavy upload and migration traffic.

---

## Goals

- Prevent long-hanging sockets under CPU pressure.
- Apply predictable backpressure (`429`/configured status + `Retry-After`).
- Reduce request-path CPU spikes.
- Expose runtime metrics for capacity tuning.

---

## Mechanism Overview

### 1) Admission Control (Backpressure)

Heavy routes are protected by admission control middleware:

- Upload routes: `/upload/*`
- Migration routes: `/migration/*`

Behavior:

- Requests are admitted immediately when `inflight < maxInflight`.
- Otherwise requests enter a short FIFO queue.
- If queue is full or wait time exceeds `queueTimeoutMs`, request is rejected.

Rejection response:

```json
{
  "error": "Server overloaded. Please retry later.",
  "code": "SERVER_OVERLOADED",
  "retryAfterMs": 15000
}
```

Headers:

- `Retry-After: <seconds>`

### 2) Request Timeout and Abort Handling

Upload and migration routes use a request-level controller:

- Timeout triggers server abort and returns timeout error.
- Client disconnect/abort is detected and work is canceled as early as possible.
- Temp file cleanup remains best-effort in failure paths.

### 3) Migration Payload Guard

Migration endpoint validates payload size before expensive processing:

- Pre-parse check: `Content-Length` (or `x-content-length`)
- Post-parse check: `contentBase64.length`

Oversized requests return `413 Payload Too Large`.

### 4) Remove Hot-Path Index Sync

`Block.syncIndexes()` is not executed in upload/migration request path anymore.
Index sync stays at startup (`mongoose.syncIndexes()`).

---

## Runtime Metrics

Endpoint:

```
GET /metrics/runtime
```

Response includes:

- Admission runtime stats per route group (`upload`, `migration`)
- Counters:
  - `migrationPayloadTooLargeTotal`
  - `requestTimeoutTotal`
  - `requestAbortedTotal`

Use this endpoint to tune queue/inflight limits and identify overload patterns.

---

## Environment Variables

```bash
UPLOAD_MAX_INFLIGHT=4
UPLOAD_QUEUE_MAX=32
UPLOAD_QUEUE_TIMEOUT_MS=15000

MIGRATION_MAX_INFLIGHT=1
MIGRATION_QUEUE_MAX=8
MIGRATION_QUEUE_TIMEOUT_MS=10000

OVERLOAD_STATUS_CODE=429

MIGRATION_MAX_PAYLOAD_BYTES=8388608
MIGRATION_MAX_BASE64_CHARS=11184812
```

---

## Operational Guidance

- Start conservative for migration (`maxInflight=1`), then raise gradually.
- Keep queue short; long queue usually means user-visible hangs.
- Prefer explicit reject/retry over unbounded waiting.
- Track `/metrics/runtime` during stress tests and adjust per host CPU profile.
