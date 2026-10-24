import type { PageServerLoad } from './$types';
import { datasetCtx, isDenied } from '$server/auth/dataset-ctx';
import { listLinks, listEventTypes, listResources } from '$server/services/scheduling.service';

export const load: PageServerLoad = async ({ locals, depends, url }) => {
  const ctx = await datasetCtx(locals, 'scheduling');
  if (isDenied(ctx)) return { scheduling: ctx }; // rendered by DataSource (spec 039)
  depends('scheduling:data');
  const [links, eventTypes, resources] = await Promise.all([
    listLinks(ctx),
    listEventTypes(ctx),
    listResources(ctx),
  ]);
  return {
    scheduling: {
      links,
      eventTypes: eventTypes.map((e) => ({ id: e.id, title: e.title })),
      resources: resources.map((r) => ({ id: r.id, name: r.name })),
      origin: url.origin,
    },
  };
};
