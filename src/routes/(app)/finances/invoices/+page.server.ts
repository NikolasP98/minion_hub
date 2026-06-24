import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { listInvoices } from '$server/services/finance.service';

export const load: PageServerLoad = async ({ locals, depends, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'finances'))) throw error(404, 'Finances module disabled');
  depends('finances:data');
  // Load the full set (capped) so the page can sort/filter client-side like the
  // CRM customers view; rendering is windowed on the client for paint cost.
  const contactId = url.searchParams.get('contact') ?? undefined;
  const { rows, total } = await listInvoices(ctx, { limit: 10_000, contactId });
  return { invoices: rows, total };
};
