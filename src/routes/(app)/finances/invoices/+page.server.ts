import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { listInvoices } from '$server/services/finance.service';
import { getContact } from '$server/services/crm-contacts.service';
import { loadCustomPropertyBundle } from '$server/services/custom-property-bundle.service';

export const load: PageServerLoad = async ({ locals, depends, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('finances:data');
  // Load the full set (capped) so the page can sort/filter client-side like the
  // CRM customers view; rendering is windowed on the client for paint cost.
  const contactId = url.searchParams.get('contact') ?? undefined;
  const [{ rows, total }, contactRec] = await Promise.all([
    listInvoices(ctx, { limit: 10_000, contactId }),
    contactId ? getContact(ctx, contactId) : Promise.resolve(null),
  ]);
  const customProperties = await loadCustomPropertyBundle(
    locals,
    ctx,
    'finances.invoices',
    rows.map((row) => row.id),
  );
  return {
    invoices: rows,
    customProperties,
    total,
    contactId: contactId ?? null,
    contactName: contactRec?.contact?.displayName ?? null,
  };
};
