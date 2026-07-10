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

export const updateState = $state({
  pending: null as PendingUpdate | null,
  lastResult: null as UpdateApplyResult | null,
  installing: false,
});

/**
 * Merge a `{ current, pending, lastResult }` status snapshot — the shape
 * returned by both GET /api/gateway/update and POST {action:'check'} — into
 * the store. Shared by the card's mount-fetch and its Check-now handler.
 */
export function applyUpdateStatus(status: {
  pending?: PendingUpdate | null;
  lastResult?: UpdateApplyResult | null;
}): void {
  if (status.pending !== undefined) updateState.pending = status.pending;
  if (status.lastResult !== undefined) updateState.lastResult = status.lastResult;
}
