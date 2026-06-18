import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { listResources, getResourceSchedule, listEventTypes } from '$server/services/scheduling.service';
import { listBookings } from '$server/services/scheduling-bookings.service';
import { listUsers } from '$server/services/user.service';

/** Monday 00:00 of the week containing `d` (local server time). */
function startOfWeek(d: Date): Date {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  const dow = s.getDay(); // 0=Sun … 6=Sat
  s.setDate(s.getDate() - ((dow + 6) % 7));
  return s;
}

export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(404, 'Scheduling module disabled');
  depends('scheduling:data');

  const weekStart = startOfWeek(new Date());
  const weekEnd = new Date(weekStart.getTime() + 7 * 86_400_000);

  // Native org members (Supabase profiles via organization_members). Degrade to
  // empty if the directory read fails so the page still renders the roster.
  const membersP = locals.tenantCtx
    ? listUsers(locals.tenantCtx).catch((e) => {
        console.warn('[scheduling/resources] listUsers failed, degrading:', e);
        return [] as Awaited<ReturnType<typeof listUsers>>;
      })
    : Promise.resolve([] as Awaited<ReturnType<typeof listUsers>>);

  const [resources, members, eventTypes, bookings] = await Promise.all([
    listResources(ctx),
    membersP,
    listEventTypes(ctx),
    listBookings(ctx, {
      from: weekStart,
      to: weekEnd,
      status: ['accepted', 'pending', 'completed'],
      limit: 1000,
    }),
  ]);

  const schedules = Object.fromEntries(
    await Promise.all(resources.map(async (r) => [r.id, await getResourceSchedule(ctx, r.id)] as const)),
  );

  return {
    weekStart: weekStart.toISOString().slice(0, 10),
    members: members.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      role: u.role,
      accountType: u.accountType,
    })),
    resources: resources.map((r) => ({
      id: r.id,
      kind: r.kind,
      profileId: r.profileId,
      name: r.name,
      email: r.email,
      timezone: r.timezone,
      color: r.color,
      active: r.active,
    })),
    schedules,
    eventTypes: eventTypes.map((e) => ({ id: e.id, title: e.title })),
    bookings: bookings.map((b) => ({
      id: b.id,
      resourceId: b.resourceId,
      eventTypeId: b.eventTypeId,
      start: b.startTime.toISOString(),
      end: b.endTime.toISOString(),
      status: b.status,
      attendeeName: b.attendeeName,
    })),
  };
};
