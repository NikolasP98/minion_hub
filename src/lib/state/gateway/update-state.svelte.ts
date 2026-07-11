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
  /** Event truth — the max progress signal actually received (ratchet). */
  progress: null as UpdateProgress | null,
  /**
   * Presentation layer over `progress`. The real installed(70) /
   * watchdog-armed(80) / restarting(90) events land within ~1s of each other,
   * which read as the bar "skipping" stages — so the DISPLAYED stage advances
   * through the received stages one at a time with a min dwell. It only ever
   * shows stages that actually arrived and never leads `progress`.
   */
  display: null as UpdateProgress | null,
});

/** Min time each real stage stays on screen before the next queued one shows. */
export const PROGRESS_DWELL_MS = 600;

let displayQueue: UpdateProgress[] = [];
let drainTimer: ReturnType<typeof setTimeout> | null = null;
let displayAdvancedAt = 0;

function scheduleDrain(): void {
  if (drainTimer || displayQueue.length === 0) return;
  const wait = Math.max(0, displayAdvancedAt + PROGRESS_DWELL_MS - Date.now());
  drainTimer = setTimeout(() => {
    drainTimer = null;
    const next = displayQueue.shift();
    if (next) {
      updateState.display = next;
      displayAdvancedAt = Date.now();
    }
    scheduleDrain();
  }, wait);
}

/**
 * True while an install is in flight and the gateway dropping the WS is the
 * EXPECTED restart step — used to keep the Updates card mounted and to swap
 * the red outage banner for a calm "updating" one.
 */
export function isUpdateRestartExpected(): boolean {
  return (
    updateState.installing || (updateState.progress !== null && updateState.progress.pct < 100)
  );
}

/**
 * Ratchet: gateway events and client stage inference race each other around
 * the restart, so the bar only ever moves forward. Use `setUpdateProgress()`
 * (not direct assignment) to reset/settle — it also clears the display queue.
 */
export function bumpUpdateProgress(p: UpdateProgress): void {
  if (updateState.progress && p.pct < updateState.progress.pct) return;
  updateState.progress = p;
  const tail = displayQueue.length > 0 ? displayQueue[displayQueue.length - 1] : updateState.display;
  if (!updateState.display) {
    // First signal of this install — show immediately.
    displayQueue = [];
    updateState.display = p;
    displayAdvancedAt = Date.now();
  } else if (tail && p.pct <= tail.pct) {
    // Same-stage refresh (e.g. updated detail text) — replace in place, no dwell.
    if (displayQueue.length > 0) displayQueue[displayQueue.length - 1] = p;
    else updateState.display = p;
  } else {
    displayQueue.push(p);
    scheduleDrain();
  }
}

/** Terminal set/reset — clears any queued display stages so nothing replays. */
export function setUpdateProgress(p: UpdateProgress | null): void {
  if (drainTimer) {
    clearTimeout(drainTimer);
    drainTimer = null;
  }
  displayQueue = [];
  updateState.progress = p;
  updateState.display = p;
  displayAdvancedAt = Date.now();
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
