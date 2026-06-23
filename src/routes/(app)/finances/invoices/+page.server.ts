import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { listInvoices } from '$server/services/finance.service';

const PAGE = 60;
const MAX_LIMIT = 500;

export const load: PageServerLoad = async ({ locals, depends, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'finances'))) throw error(404, 'Finances module disabled');
  depends('finances:data');
  // Server-side pagination: `?show=N` (cumulative, clamped) drives how many rows
  // the page has scrolled in. Scrolling near the bottom bumps it via `goto`, so
  // rows load lazily from the server instead of fetching all 5000 up front.
  const requested = Number(url.searchParams.get('show')) || PAGE;
  const limit = Math.min(Math.max(requested, PAGE), MAX_LIMIT);
  const contactId = url.searchParams.get('contact') ?? undefined;
  const { rows, total } = await listInvoices(ctx, { limit, contactId });
  return { invoices: rows, total, limit };
};
