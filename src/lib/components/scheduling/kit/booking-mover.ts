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
  setStatus(id: string, status: string): Promise<void>;
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

  async function setStatus(id: string, status: string): Promise<void> {
    await fetch(`${config.apiBase}/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    await config.refresh();
  }

  return { moveBooking, setStatus };
}
