/** Spec 147 — the one client call both calendars use to reopen an agenda closure. */
import { toastError, toastSuccess } from '$lib/state/ui/toast.svelte';
import * as m from '$lib/paraglide/messages';
import type { CalendarClosure } from '../calendar-window';

/** POST the reopen and refresh on success; a 403 says the role can't (never a generic failure). */
export async function reopenClosure(
  c: CalendarClosure,
  group: boolean,
  refresh: () => Promise<void>,
): Promise<boolean> {
  try {
    const res = await fetch(`/api/scheduling/closures/${c.id}/reopen`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ group }),
    });
    if (!res.ok) {
      toastError(res.status === 403 ? m.cal_closure_forbidden() : m.cal_closure_failed());
      return false;
    }
    await refresh();
    toastSuccess(m.cal_closure_reopened());
    return true;
  } catch {
    toastError(m.cal_closure_failed());
    return false;
  }
}
