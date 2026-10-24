import type { PageServerLoad } from './$types';
import { datasetCtx, isDenied } from '$server/auth/dataset-ctx';
import { ownerFilter } from '$server/services/rbac.service';
import { listOrders } from '$server/services/sales.service';
import { getContact } from '$server/services/crm-contacts.service';

export const load: PageServerLoad = async ({ locals, url, depends }) => {
  const ctx = await datasetCtx(locals, 'sales');
  if (isDenied(ctx)) return { sales: ctx }; // rendered by DataSource (spec 039)
  depends('sales:list');

  // Cross-module nav: ?contact= scopes the list to one contact (Connections panel).
  const contact = url.searchParams.get('contact') ?? undefined;
  // The contact's NAME is CRM data: own handle; denied => no name (spec 039).
  const crm = await datasetCtx(locals, 'crm');
  const ownerId = await ownerFilter(locals, 'sales');
  const [orders, contactRec] = await Promise.all([
    listOrders(ctx, { crmContactId: contact, limit: 200, ownerId }),
    contact && !isDenied(crm) ? getContact(crm, contact) : Promise.resolve(null),
  ]);
  const open = orders.filter((o) => o.status === 'draft' || o.status === 'confirmed');
  const committed = open.reduce((s, o) => s + Number(o.total ?? 0), 0);
  return {
    sales: {
      orders,
      stats: { open: open.length, committed },
      contactId: contact ?? null,
      contactName: contactRec?.contact?.displayName ?? null,
    },
  };
};
