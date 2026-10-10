/**
 * Everything a calendar drag can commit, on ONE function — the calendar owns
 * the dialogs that produce `MoveOpts`. Lifted verbatim from
 * `/pos/appointments/+page.svelte`'s `moveBooking`/`setStatus`, generalised
 * over `apiBase` so `/scheduling/calendar` can share it
 * (`/api/scheduling/bookings` + its `[id]/group` twin instead of
 * `/api/pos/appointments`).
 *
 *   plain / overrideConflicts → PATCH the booking (server re-runs the
 *     buffer-padded conflict check and answers 409 with the clashes)
 *   mergeWith → join that booking's visit (back-to-back, one block)
 *   detach    → leave the visit, keeping the time
 *   group     → move/resize the WHOLE visit this booking belongs to
 *
 * Status is the same split: `setStatus` PATCHes the one row, `setVisitStatus`
 * POSTs `{ status }` to `/group` so every eligible service of the event moves.
 *
 * Three of the four shapes are visit work and go to `{apiBase}/{id}/group` as
 * ONE POST; only a plain single-booking reschedule is a PATCH on the booking
 * itself — `group` must not fan out into per-member PATCHes, since the
 * container is a shared window and the whole visit moves in one transaction
 * behind one conflict check.
 *
 * A 409 is not toasted here: the conflicts go back to the caller, which names
 * them in a dialog offering "Move anyway" / "Pick another time" / "Merge".
 * Nothing needs reverting — the boxes render from the caller's own load, so a
 * refused move never left its slot.
 */
import { createOptimistic } from '$lib/utils/optimistic';
import { toastError } from '$lib/state/ui/toast.svelte';
import * as m from '$lib/paraglide/messages';
import type { MoveConflict, MoveOpts, MoveResult } from '../move-conflict';

export interface BookingMoverConfig {
  /** e.g. `/api/pos/appointments` or `/api/scheduling/bookings`. */
  apiBase: string;
  /** A move/status change failed for a reason OTHER than a 409 conflict (the
   *  caller supplies its own localized title, e.g. `toastError(m.sched_move_failed(), detail)`). */
  onError: (detail?: string) => void;
  /** Re-run the caller's load after a mutation lands. */
  refresh: () => Promise<void>;
}

export interface BookingMover {
  moveBooking(
    id: string,
    next: { start: string; end: string; resourceId: string },
    opts?: MoveOpts,
  ): Promise<MoveResult | void>;
  /** Optimistic (owner ask 2026-09-29: "go optimist on the UI feedback" —
   *  cancel/no-show paint immediately and revert + toast on a non-OK
   *  response, instead of waiting for the reload). */
  setStatus(id: string, status: string): Promise<void>;
  /** The status of the WHOLE event (every eligible service of the visit `id`
   *  belongs to) — `POST …/[id]/group { status }`, which the server applies
   *  member by member and reports `applied`/`skipped` for. Same optimistic
   *  overlay as `setStatus`, keyed on the id handed in (the visit's lead), so
   *  a box painting from `statusOf(lead.id, …)` flips immediately.
   *  Any booking status: `pending` un-confirms the accepted services (the
   *  board's Pending column), `accepted` confirms the pending ones, a terminal
   *  target closes whatever is still live. */
  setVisitStatus(id: string, status: string, reason?: string): Promise<void>;
  /** The status to render for `id`: the in-flight one while `setStatus` is
   *  pending, else `committed` (the booking's own server status). */
  statusOf(id: string, committed: string): string;
  pending(id: string): boolean;
  /** Fan-deck drag-to-reorder (owner ask 2026-09-29 — the drag alternative to
   *  the Separate button): restamps `groupSeq` for the whole visit. `id` is
   *  any member of the visit — the server resolves its `groupId`, same as a
   *  plain `moveBooking` group op. */
  reorderVisit(id: string, ids: string[]): Promise<void>;
}

export function createBookingMover(config: BookingMoverConfig): BookingMover {
  async function moveBooking(
    id: string,
    next: { start: string; end: string; resourceId: string },
    opts?: MoveOpts,
  ): Promise<MoveResult | void> {
    const override = opts?.overrideConflicts ? { overrideConflicts: true } : {};
    const groupBody =
      opts?.mergeWith !== undefined
        ? { withId: opts.mergeWith, ...override }
        : opts?.detach
          ? { detach: true, ...override }
          : opts?.group
            ? { move: next, ...override }
            : null;
    const res = await fetch(
      groupBody ? `${config.apiBase}/${id}/group` : `${config.apiBase}/${id}`,
      {
        method: groupBody ? 'POST' : 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(groupBody ?? { ...next, ...override }),
      },
    );
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        conflicts?: MoveConflict[];
      };
      if (res.status === 409 && j.conflicts?.length) return { conflicts: j.conflicts };
      config.onError(j.message ?? `HTTP ${res.status}`);
    }
    await config.refresh();
  }

  const statusOverlay = createOptimistic<string>();

  /** Both status writes are the same optimistic overlay over one request; only
   *  the route and the body differ (the per-row PATCH vs the visit-wide POST). */
  async function commitStatus(
    id: string,
    status: string,
    url: string,
    init: RequestInit,
  ): Promise<void> {
    const ok = await statusOverlay.run(id, status, async () => {
      const res = await fetch(url, init);
      return res.ok;
    });
    if (!ok) toastError(m.sched_status_failed());
    await config.refresh();
  }

  const setStatus = (id: string, status: string): Promise<void> =>
    commitStatus(id, status, `${config.apiBase}/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    });

  // `reason` is OMITTED when absent, not sent as null: the group body is a
  // `strictObject` whose `reason` is an optional STRING.
  const setVisitStatus = (id: string, status: string, reason?: string): Promise<void> =>
    commitStatus(id, status, `${config.apiBase}/${id}/group`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(reason ? { status, reason } : { status }),
    });

  async function reorderVisit(id: string, ids: string[]): Promise<void> {
    const res = await fetch(`${config.apiBase}/${id}/group`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reorder: ids }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { message?: string };
      config.onError(j.message ?? `HTTP ${res.status}`);
    }
    await config.refresh();
  }

  return {
    moveBooking,
    setStatus,
    setVisitStatus,
    statusOf: (id, committed) => statusOverlay.get(id, committed),
    pending: (id) => statusOverlay.isPending(id),
    reorderVisit,
  };
}
