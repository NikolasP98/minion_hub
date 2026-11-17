import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { datasetCtx, isDenied } from '$server/auth/dataset-ctx';
import { loadCustomPropertyBundle } from '$server/services/custom-property-bundle.service';
import {
  listEntriesPage,
  resolveMovementAdmission,
  MovementError,
} from '$server/services/stock-entries-read.service';

export const load: PageServerLoad = async ({ locals, url, depends }) => {
  const ctx = await datasetCtx(locals, 'stock');
  if (isDenied(ctx)) return { stock: ctx }; // rendered by DataSource (spec 039)
  depends('stock:entries');

  // Spec 125: one bounded page (50) + page-qualified labels inside one REPEATABLE READ snapshot.
  // Replaces the unbounded listEntries/listItems/listWarehouses/countAttachmentsByObjects reads.
  const partyId = url.searchParams.get('party') || undefined;
  const admission = await resolveMovementAdmission(locals, ctx);
  let page;
  try {
    page = await listEntriesPage(ctx, admission, {
      cursor: url.searchParams.get('cursor'),
      partyId,
    });
  } catch (e) {
    if (e instanceof MovementError) throw error(e.status, e.code);
    throw e;
  }
  const { movements, warehouseCount } = page;
  const customProperties = await loadCustomPropertyBundle(
    locals,
    ctx,
    'stock.entries',
    movements.rows.map((r) => r.entryId),
  );

  return {
    stock: {
      movements,
      customProperties,
      partyFilter: partyId ?? null,
      // Gates the Transfer action: active warehouses only (independent of label dictionaries).
      warehouseCount,
    },
  };
};
