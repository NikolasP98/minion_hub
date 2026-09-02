import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import { listEventTypes, listResources } from '$server/services/scheduling.service';
import { listSellables } from '$server/services/pos.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('scheduling:data');

  const [eventTypes, resources] = await Promise.all([listEventTypes(ctx), listResources(ctx)]);

  // The scheduler's services ARE the catalog's service-kind sellables; an
  // event type linked via `productId` is what makes one bookable. Data-bearing,
  // not a route gate — a missing/off POS module just yields an empty list.
  let services: Array<{ id: string; name: string }> = [];
  try {
    services = (await listSellables(ctx))
      .filter((s) => s.kind === 'service')
      .map((s) => ({ id: s.productId, name: s.name }));
  } catch {
    services = [];
  }

  return { eventTypes, resources, services };
};
