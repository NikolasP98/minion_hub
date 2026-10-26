import type { PageServerLoad } from './$types';
import { datasetCtx, isDenied } from '$server/auth/dataset-ctx';
import { listDoorsWithFunnel, resolveDoorRange } from '$server/services/doors.service';
import { resolveOrgTimezone } from '$server/services/inbox/daily-feed.service';
import { registeredDoorKinds } from '$lib/doors/kinds';

/** Doors view (spec 041 US7). View access is wired centrally via the `crm.doors` sub-resource. */
export const load: PageServerLoad = async ({ locals, url, depends }) => {
  const ctx = await datasetCtx(locals, 'crm');
  if (isDenied(ctx)) return { crm: ctx }; // rendered by DataSource in +page.svelte (spec 039)
  depends('crm:doors');
  const tz = await resolveOrgTimezone(ctx);
  const range = resolveDoorRange(url.searchParams, tz);
  return {
    crm: {
      range,
      doors: await listDoorsWithFunnel(ctx, range, tz),
      kinds: registeredDoorKinds(),
      origin: url.origin,
    },
  };
};
