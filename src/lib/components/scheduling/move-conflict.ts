/**
 * The reschedule conflict a move can come back with, and the one human line the
 * calendar's conflict dialog shows per clash.
 *
 * The server's 409 names the clashing BOOKING (id, title, instants, resource);
 * the client owns the wording because only it has the locale formatters, the
 * resource names and the client names already on screen.
 */

/** One clash, as `PATCH /api/{pos/appointments,scheduling/bookings}/[id]` reports it. */
export interface MoveConflict {
  id: string;
  title: string | null;
  /** ISO instant. */
  start: string;
  /** ISO instant. */
  end: string;
  resourceId: string;
}

/**
 * What a calendar drag is asking the route to commit. A plain move passes none
 * of them; the rest are the outcomes of the calendar's own dialogs, kept on ONE
 * callback so the route needs a single booking-mutation function.
 */
export interface MoveOpts {
  /** "Move anyway" — land the move despite the reported clash. */
  overrideConflicts?: boolean;
  /** "Merge" — join the visit this booking id belongs to instead of moving. */
  mergeWith?: string;
  /** "Separate" — leave the merged visit, restoring the pre-merge duration. */
  detach?: boolean;
  /** Move/resize the whole visit `id` belongs to, not just that member: ONE
   *  container call (`{ move: … }` on `/group`) instead of N reschedules. */
  group?: boolean;
}

/** What the route hands back: nothing when it landed, the 409's clashes when not. */
export interface MoveResult {
  conflicts?: MoveConflict[];
}

/**
 * `<service> · <client> · 20:30–20:45 (<staff>)` — every part optional except
 * the time range, because a clash with a booking outside the loaded window has
 * no local row to read a client or service off. Times come from the caller's
 * `hhmm` (the same locale-pinned formatter the grid uses), never a raw ISO.
 */
export function conflictLine(
  c: MoveConflict,
  ctx: {
    hhmm: (iso: string) => string;
    service?: string | null;
    client?: string | null;
    staff?: string | null;
  },
): string {
  const parts = [ctx.service ?? c.title, ctx.client, `${ctx.hhmm(c.start)}–${ctx.hhmm(c.end)}`]
    .filter((p): p is string => !!p && p.trim() !== '')
    .join(' · ');
  return ctx.staff ? `${parts} (${ctx.staff})` : parts;
}
