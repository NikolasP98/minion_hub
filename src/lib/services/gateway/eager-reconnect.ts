/**
 * Pure eager-reconnect scheduler. Separated from gateway.svelte.ts so it can
 * be tested without Svelte runes (same pattern as config-restart.ts).
 *
 * During an announced restart window (fleet update drain, config-save
 * restart, 1012 close) the shared GatewayClient's exponential backoff
 * (800ms x1.7, capped 15s) is the wrong tool — the outage is bounded and
 * expected. While armed, the hub bypasses that backoff and probes on a flat
 * ~1s cadence instead. See specs/2026-07-11-ws-failover-eager-reconnect.md §3.2.
 */

const DEFAULT_ARM_MS = 180_000;
const FLAT_DELAY_MS = 750;
const JITTER_MS = 250;

let armedUntil = 0;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

/** Arm the eager window for `durationMs` (default 3 minutes) from now. */
export function armEagerReconnect(durationMs = DEFAULT_ARM_MS): void {
  armedUntil = Date.now() + durationMs;
}

/** Disarm the window and drop any pending eager-reconnect timer. */
export function disarmEagerReconnect(): void {
  armedUntil = 0;
  clearPendingEagerReconnect();
}

/** True while inside an armed window (i.e. an expected-restart is in flight). */
export function isEagerReconnectArmed(): boolean {
  return Date.now() < armedUntil;
}

/** Cancel a scheduled eager-reconnect attempt, if any (no-op otherwise). */
export function clearPendingEagerReconnect(): void {
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
}

/**
 * Schedule exactly one eager reconnect attempt (flat 750ms + 0-250ms
 * jitter). Replaces any already-pending attempt so callers never stack
 * timers on repeated closes.
 */
export function scheduleEagerReconnect(fn: () => void): void {
  clearPendingEagerReconnect();
  const delay = FLAT_DELAY_MS + Math.random() * JITTER_MS;
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    fn();
  }, delay);
}

/** Test-only: whether an eager reconnect is currently scheduled. */
export function hasPendingEagerReconnect(): boolean {
  return pendingTimer !== null;
}
