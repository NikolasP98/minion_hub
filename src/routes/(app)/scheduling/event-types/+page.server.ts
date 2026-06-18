import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled, bothEnabled } from '$server/services/modules.service';
import { listEventTypes, listResources } from '$server/services/scheduling.service';
import { listProducts } from '$server/services/finance-products.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(404, 'Scheduling module disabled');
  depends('scheduling:data');

  const [eventTypes, resources] = await Promise.all([listEventTypes(ctx), listResources(ctx)]);

  // Procedure list (finance bridge) — only when finances is also enabled.
  let products: Array<{ id: string; name: string }> = [];
  try {
    if (await bothEnabled(ctx, 'scheduling', 'finances')) {
      products = (await listProducts(ctx)).map((p) => ({ id: p.id, name: p.name }));
    }
  } catch {
    products = [];
  }

  return { eventTypes, resources, products };
};
