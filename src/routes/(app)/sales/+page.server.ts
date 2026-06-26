import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import { ownerFilter } from '$server/services/rbac.service';
import { isModuleEnabled } from '$server/services/modules.service';
import { listOrders } from '$server/services/sales.service';
import { getContact } from '$server/services/crm-contacts.service';

export const load: PageServerLoad = async ({ locals, url, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'sales'))) throw error(404, 'Sales module disabled');
  depends('sales:list');

  // Cross-module nav: ?contact= scopes the list to one contact (Connections panel).
  const contact = url.searchParams.get('contact') ?? undefined;
  const ownerId = await ownerFilter(locals, 'sales');
  const [orders, contactRec] = await Promise.all([
    listOrders(ctx, { crmContactId: contact, limit: 200, ownerId }),
    contact ? getContact(ctx, contact) : Promise.resolve(null),
  ]);
  const open = orders.filter((o) => o.status === 'draft' || o.status === 'confirmed');
  const committed = open.reduce((s, o) => s + Number(o.total ?? 0), 0);
  return {
    orders,
    stats: { open: open.length, committed },
    contactId: contact ?? null,
    contactName: contactRec?.contact?.displayName ?? null,
  };
};
