import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { ownerFilter, shouldMaskSensitive } from '$server/services/rbac.service';
import { getContactGraph } from '$server/services/crm-contacts.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  depends('crm:graph');
  const ctx = await requireCoreCtx(locals);
  // Record-level (if-owner) + field-level (PII) scoping — same mechanism as
  // the Customers list (crm/+page.server.ts) — the graph must not bypass it.
  const [ownerId, maskSensitive] = await Promise.all([
    ownerFilter(locals, 'crm'),
    shouldMaskSensitive(locals, 'crm'),
  ]);
  const rows = await getContactGraph(ctx, { ownerId, maskSensitive }).catch(() => {
    throw error(500, 'Failed to load CRM graph data');
  });
  return { rows };
};
