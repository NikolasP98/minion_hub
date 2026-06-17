import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { dashboardRows, listInvoices } from '$server/services/finance.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'finances'))) throw error(404, 'Finances module disabled');
  depends('finances:data');
  const [{ monthly }, invoices] = await Promise.all([dashboardRows(ctx), listInvoices(ctx, { limit: 1 })]);
  const totalRevenue = monthly.reduce((a, m) => a + m.revenue, 0);
  return { monthly, totalRevenue, hasData: invoices.length > 0 };
};
