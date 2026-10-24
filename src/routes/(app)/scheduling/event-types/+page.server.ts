import type { PageServerLoad } from './$types';
import { datasetCtx, isDenied } from '$server/auth/dataset-ctx';
import { listEventTypes, listResources, listEventKinds } from '$server/services/scheduling.service';
import { listSellables } from '$server/services/pos.service';
import { listTags } from '$server/services/crm-contacts.service';
import { getTagLinks } from '$server/services/tag-links.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await datasetCtx(locals, 'scheduling');
  if (isDenied(ctx)) return { scheduling: ctx }; // rendered by DataSource (spec 039)
  depends('scheduling:data');
  // Foreign datasets through their own handles; denied => empty slot (spec 039).
  const crm = await datasetCtx(locals, 'crm');
  const pos = await datasetCtx(locals, 'pos');

  const [eventTypes, resources, kinds, tags] = await Promise.all([
    listEventTypes(ctx),
    listResources(ctx),
    listEventKinds(ctx),
    isDenied(crm) ? Promise.resolve([]) : listTags(crm, 'catalog'),
  ]);
  const tagsByEventType = isDenied(crm)
    ? new Map<string, { id: string; name: string; color: string | null }[]>()
    : await getTagLinks(
        crm,
        'event_type',
        eventTypes.map((e) => e.id),
      );

  // The scheduler's services ARE the catalog's service-kind sellables; an
  // event type linked via `productId` is what makes one bookable. Data-bearing,
  // not a route gate — a missing/off POS module just yields an empty list.
  let services: Array<{ id: string; name: string }> = [];
  try {
    if (isDenied(pos)) throw new Error('pos denied');
    services = (await listSellables(pos))
      .filter((s) => s.kind === 'service')
      .map((s) => ({ id: s.productId, name: s.name }));
  } catch {
    services = [];
  }

  return {
    scheduling: {
      eventTypes,
      resources,
      services,
      kinds,
      tags: tags.map((t) => ({ id: t.id, name: t.name, color: t.color })),
      eventTypeTags: Object.fromEntries(
        [...tagsByEventType].map(([id, ts]) => [id, ts.map((t) => t.id)]),
      ),
    },
  };
};
