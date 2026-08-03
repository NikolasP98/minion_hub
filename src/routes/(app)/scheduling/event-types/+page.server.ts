import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import { listEventTypes, listResources } from '$server/services/scheduling.service';
import { listProducts } from '$server/services/finance-products.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('scheduling:data');

  const [eventTypes, resources] = await Promise.all([listEventTypes(ctx), listResources(ctx)]);

  // Procedure list (finance bridge) — only when finances is also enabled.
  // Data-bearing, not a route gate (not a manifest composite): reads the
  // hook's per-request module-state snapshot instead of re-querying (R5).
  let products: Array<{ id: string; name: string }> = [];
  try {
    const financeBridgeEnabled =
      (locals.moduleStates?.scheduling ?? true) && (locals.moduleStates?.finances ?? true);
    if (financeBridgeEnabled) {
      products = (await listProducts(ctx)).map((p) => ({ id: p.id, name: p.name }));
    }
  } catch {
    products = [];
  }

  return { eventTypes, resources, products };
};
