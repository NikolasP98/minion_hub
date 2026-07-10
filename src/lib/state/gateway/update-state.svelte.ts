/**
 * Gateway self-update state — mirrors the gateway's UpdateStatusInfo shape
 * (see minion `src/gateway/update-notify.ts`). Populated by:
 *  - initial fetch('/api/gateway/update') on the Updates card mount,
 *  - the 'update.available' / 'update.applied' WS events (gateway.svelte.ts),
 *  - POST /api/gateway/update responses (Check now / Install & restart).
 */
export type PendingUpdate = {
  version: string;
  sha?: string;
  notes?: string;
  source: 'webhook' | 'check';
  detectedAt: string;
};

export type UpdateApplyResult = {
  ok: boolean;
  from: string;
  to: string;
  rolledBackTo?: string;
  detail?: string;
  at: string;
};

/**
 * Live install progress. Real signal only — populated by the gateway's
 * `update.progress` WS events (phases starting/installing/installed/
 * watchdog-armed/restarting at pct 5/15/70/80/90) with client-side stage
 * inference as a fallback for gateways that don't emit them yet
 * (run dispatched=5, run accepted=15, run response ok=70, WS dropped=90,
 * reconnected on the pending version=100).
 */
export type UpdateProgress = {
  phase: string;
  pct: number;
  version?: string;
  detail?: string;
};

export const updateState = $state({
  /** Full current version from update.status (e.g. 2026.7.10-dev.20260710220841). */
  current: null as string | null,
  pending: null as PendingUpdate | null,
  lastResult: null as UpdateApplyResult | null,
  installing: false,
  progress: null as UpdateProgress | null,
});

/**
 * Ratchet: gateway events and client stage inference race each other around
 * the restart, so the bar only ever moves forward. Direct assignment to
 * `updateState.progress` (installNow start / explicit failure) resets it.
 */
export function bumpUpdateProgress(p: UpdateProgress): void {
  if (!updateState.progress || p.pct >= updateState.progress.pct) updateState.progress = p;
}

/**
 * Merge a `{ current, pending, lastResult }` status snapshot — the shape
 * returned by both GET /api/gateway/update and POST {action:'check'} — into
 * the store. Shared by the card's mount-fetch and its Check-now handler.
 */
export function applyUpdateStatus(status: {
  current?: string | null;
  pending?: PendingUpdate | null;
  lastResult?: UpdateApplyResult | null;
}): void {
  if (status.current !== undefined) updateState.current = status.current;
  if (status.pending !== undefined) updateState.pending = status.pending;
  if (status.lastResult !== undefined) updateState.lastResult = status.lastResult;
}
