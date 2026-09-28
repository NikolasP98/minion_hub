import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import { getTicket } from '$server/services/pos.service';
import { uuidParamOr404 } from '$server/utils/uuid-param';

/**
 * A submitted POS ticket, read-only — the "invoice page" the appointment drawer
 * and the payments hover card link to. The module-toggle 404 is enforced
 * centrally by the (app) route hook guard (routing-simplification spec S2), and
 * `pos:view` comes from the `/pos` prefix rule in the route-access registry, so
 * this load only resolves the record.
 */
export const load: PageServerLoad = async ({ locals, params, depends }) => {
  uuidParamOr404(params.id);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('pos:ticket');

  const ticket = await getTicket(ctx, params.id);
  if (!ticket) throw error(404, 'Ticket not found');
  return ticket;
};
