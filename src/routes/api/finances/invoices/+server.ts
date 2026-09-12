import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { listInvoices } from '$server/services/finance.service';

/** GET /api/finances/invoices?q=&limit= — invoice picker search (booking↔invoice
 *  link, spec S6). Read-only; not a write route, so no API_WRITE_PREFIXES entry. */
export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const q = url.searchParams.get('q') ?? undefined;
  const limit = Math.min(Number(url.searchParams.get('limit')) || 20, 50);
  const { rows } = await listInvoices(ctx, { q, limit });
  return json(rows);
};
