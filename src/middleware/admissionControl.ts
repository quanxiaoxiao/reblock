import type { Context, Next } from 'hono';
import { logService } from '../services/logService';

export type AdmissionRejectReason = 'queue_full' | 'queue_timeout';

interface QueueNode {
  enqueuedAt: number;
  timer: NodeJS.Timeout;
  settled: boolean;
  resolve: (value: { waitMs: number }) => void;
  reject: (error: Error) => void;
}

interface AdmissionRuntimeState {
  name: string;
  maxInflight: number;
  queueMax: number;
  queueTimeoutMs: number;
  inflight: number;
  queued: number;
  admittedTotal: number;
  queuedTotal: number;
  rejectedTotal: number;
  rejectedQueueFull: number;
  rejectedQueueTimeout: number;
  totalQueueWaitMs: number;
  maxQueueWaitMs: number;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface AdmissionRuntimeSnapshot extends AdmissionRuntimeState {}

interface AdmissionConfig {
  name: string;
  maxInflight: number;
  queueMax: number;
  queueTimeoutMs: number;
  overloadStatusCode: number;
}

export interface AdmissionControlOptions {
  name: string;
  maxInflight: number;
  queueMax: number;
  queueTimeoutMs: number;
  overloadStatusCode?: number;
}

const runtimeStates = new Map<string, AdmissionRuntimeState>();

const runtimeCounters = {
  migrationPayloadTooLargeTotal: 0,
  requestTimeoutTotal: 0,
  requestAbortedTotal: 0,
};

function getOrCreateRuntimeState(config: AdmissionConfig): AdmissionRuntimeState {
  const existing = runtimeStates.get(config.name);
  if (existing) {
    return existing;
  }

  const created: AdmissionRuntimeState = {
    name: config.name,
    maxInflight: config.maxInflight,
    queueMax: config.queueMax,
    queueTimeoutMs: config.queueTimeoutMs,
    inflight: 0,
    queued: 0,
    admittedTotal: 0,
    queuedTotal: 0,
    rejectedTotal: 0,
    rejectedQueueFull: 0,
    rejectedQueueTimeout: 0,
    totalQueueWaitMs: 0,
    maxQueueWaitMs: 0,
  };

  runtimeStates.set(config.name, created);
  return created;
}

function toRetryAfterSeconds(queueTimeoutMs: number): string {
  const seconds = Math.max(1, Math.ceil(queueTimeoutMs / 1000));
  return String(seconds);
}

export function incrementRuntimeCounter(counter: keyof typeof runtimeCounters): void {
  runtimeCounters[counter] += 1;
}

export function getRuntimeCountersSnapshot(): Record<keyof typeof runtimeCounters, number> {
  return { ...runtimeCounters };
}

export function getAdmissionRuntimeSnapshot(): AdmissionRuntimeSnapshot[] {
  return Array.from(runtimeStates.values()).map((state) => ({ ...state }));
}

export function createAdmissionControl(options: AdmissionControlOptions) {
  const config: AdmissionConfig = {
    ...options,
    overloadStatusCode: options.overloadStatusCode ?? 429,
  };

  const queue: QueueNode[] = [];
  const state = getOrCreateRuntimeState(config);

  const rejectRequest = async (
    c: Context,
    reason: AdmissionRejectReason
  ): Promise<Response> => {
    state.rejectedTotal += 1;
    if (reason === 'queue_full') {
      state.rejectedQueueFull += 1;
    } else {
      state.rejectedQueueTimeout += 1;
    }

    try {
      await logService.logAction({
        action: 'admission_rejected',
        success: true,
        details: {
          routeGroup: config.name,
          reason,
          inflight: state.inflight,
          queued: state.queued,
          maxInflight: config.maxInflight,
          queueMax: config.queueMax,
        },
        note: 'Request rejected by admission control',
        actor: 'admission-control',
      });
    } catch {
      // Best effort logging
    }

    const retryAfter = toRetryAfterSeconds(config.queueTimeoutMs);

    return c.json(
      {
        error: 'Server overloaded. Please retry later.',
        code: 'SERVER_OVERLOADED',
        retryAfterMs: config.queueTimeoutMs,
      },
      config.overloadStatusCode as 429 | 503,
      {
        'Retry-After': retryAfter,
      }
    );
  };

  const tryDrainQueue = () => {
    while (state.inflight < config.maxInflight && queue.length > 0) {
      const next = queue.shift();
      if (!next || next.settled) continue;

      next.settled = true;
      clearTimeout(next.timer);

      const waitMs = Math.max(0, Date.now() - next.enqueuedAt);
      state.queued = queue.length;
      state.inflight += 1;
      state.admittedTotal += 1;
      state.totalQueueWaitMs += waitMs;
      if (waitMs > state.maxQueueWaitMs) {
        state.maxQueueWaitMs = waitMs;
      }

      next.resolve({ waitMs });
    }
  };

  const releaseSlot = () => {
    state.inflight = Math.max(0, state.inflight - 1);
    tryDrainQueue();
  };

  const waitForSlot = (): Promise<{ waitMs: number }> => {
    if (state.inflight < config.maxInflight) {
      state.inflight += 1;
      state.admittedTotal += 1;
      return Promise.resolve({ waitMs: 0 });
    }

    if (queue.length >= config.queueMax) {
      throw new Error('QUEUE_FULL');
    }

    state.queuedTotal += 1;

    return new Promise<{ waitMs: number }>((resolve, reject) => {
      const node: QueueNode = {
        enqueuedAt: Date.now(),
        settled: false,
        timer: setTimeout(() => {
          if (node.settled) return;
          node.settled = true;
          const idx = queue.indexOf(node);
          if (idx >= 0) queue.splice(idx, 1);
          state.queued = queue.length;
          reject(new Error('QUEUE_TIMEOUT'));
        }, config.queueTimeoutMs),
        resolve,
        reject,
      };

      queue.push(node);
      state.queued = queue.length;
    });
  };

  return async function admissionControl(c: Context, next: Next): Promise<Response | void> {
    let acquired = false;

    try {
      const { waitMs } = await waitForSlot();
      acquired = true;

      if (waitMs > 0) {
        try {
          await logService.logAction({
            action: 'admission_queued_request',
            success: true,
            details: {
              routeGroup: config.name,
              waitMs,
              inflightAfterAcquire: state.inflight,
              queuedAfterAcquire: state.queued,
            },
            note: 'Request admitted after queue wait',
            actor: 'admission-control',
          });
        } catch {
          // Best effort logging
        }
      }

      await next();
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'QUEUE_FULL') {
        return rejectRequest(c, 'queue_full');
      }
      if (message === 'QUEUE_TIMEOUT') {
        return rejectRequest(c, 'queue_timeout');
      }
      throw error;
    } finally {
      if (acquired) {
        releaseSlot();
      }
    }
  };
}
