import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { shouldMaskSensitive } from '$server/services/rbac.service';
import { isModuleEnabled } from '$server/services/modules.service';
import {
  loadCalendarEvents,
  CalendarRangeTooLargeError,
} from '$server/scheduling/load-calendar-events';
import type { CalendarPayload } from '$lib/components/scheduling/calendar/types';

/** GET /api/scheduling/calendar?from=<ISO>&to=<ISO> */
export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  const fromRaw = url.searchParams.get('from');
  const toRaw = url.searchParams.get('to');
  if (!fromRaw || !toRaw) throw error(400, 'from and to are required');
  const from = new Date(fromRaw);
  const to = new Date(toRaw);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw error(400, 'invalid from/to');
  }
  try {
    const events = await loadCalendarEvents(ctx, {
      from,
      to,
      maskAttendeePii: await shouldMaskSensitive(locals, 'scheduling'),
    });
    const payload: CalendarPayload = { from: from.toISOString(), to: to.toISOString(), events };
    return json(payload);
  } catch (e) {
    if (e instanceof CalendarRangeTooLargeError) throw error(400, e.message);
    throw e;
  }
};
