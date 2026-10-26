import type { PageServerLoad } from './$types';
import { datasetCtx, isDenied } from '$server/auth/dataset-ctx';
import { listInvoices } from '$server/services/finance.service';
import { getContact } from '$server/services/crm-contacts.service';
import { loadCustomPropertyBundle } from '$server/services/custom-property-bundle.service';

export const load: PageServerLoad = async ({ locals, depends, url }) => {
  const ctx = await datasetCtx(locals, 'finance');
  if (isDenied(ctx)) return { finance: ctx }; // rendered by DataSource (spec 039)
  depends('finances:data');
  // Load the full set (capped) so the page can sort/filter client-side like the
  // CRM customers view; rendering is windowed on the client for paint cost.
  const contactId = url.searchParams.get('contact') ?? undefined;
  // The contact's NAME is CRM data: own handle; denied => no name (spec 039).
  const crm = await datasetCtx(locals, 'crm');
  const [{ rows, total }, contactRec] = await Promise.all([
    listInvoices(ctx, { limit: 10_000, contactId }),
    contactId && !isDenied(crm) ? getContact(crm, contactId) : Promise.resolve(null),
  ]);
  const customProperties = await loadCustomPropertyBundle(
    locals,
    ctx,
    'finances.invoices',
    rows.map((row) => row.id),
  );
  return {
    finance: {
      invoices: rows,
      customProperties,
      total,
      contactId: contactId ?? null,
      contactName: contactRec?.contact?.displayName ?? null,
    },
  };
};
