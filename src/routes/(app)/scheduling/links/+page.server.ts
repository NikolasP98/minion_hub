import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { listLinks, listEventTypes, listResources } from '$server/services/scheduling.service';

export const load: PageServerLoad = async ({ locals, depends, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(404, 'Scheduling module disabled');
  depends('scheduling:data');
  const [links, eventTypes, resources] = await Promise.all([listLinks(ctx), listEventTypes(ctx), listResources(ctx)]);
  return {
    links,
    eventTypes: eventTypes.map((e) => ({ id: e.id, title: e.title })),
    resources: resources.map((r) => ({ id: r.id, name: r.name })),
    origin: url.origin,
  };
};
