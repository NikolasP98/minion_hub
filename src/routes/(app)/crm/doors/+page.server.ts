import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import { listDoorsWithFunnel, resolveDoorRange } from '$server/services/doors.service';
import { resolveOrgTimezone } from '$server/services/inbox/daily-feed.service';
import { registeredDoorKinds } from '$lib/doors/kinds';

/** Doors view (spec 041 US7). View access is wired centrally via the `crm.doors` sub-resource. */
export const load: PageServerLoad = async ({ locals, url, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('crm:doors');
  const tz = await resolveOrgTimezone(ctx);
  const range = resolveDoorRange(url.searchParams, tz);
  return {
    range,
    doors: await listDoorsWithFunnel(ctx, range, tz),
    kinds: registeredDoorKinds(),
    origin: url.origin,
  };
};
