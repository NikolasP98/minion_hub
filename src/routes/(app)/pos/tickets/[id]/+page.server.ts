import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { datasetCtx, isDenied } from '$server/auth/dataset-ctx';
import { getPosSettings, getTicket } from '$server/services/pos.service';
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
  const ctx = await datasetCtx(locals, 'pos');
  if (isDenied(ctx)) return { pos: ctx }; // rendered by DataSource in +page.svelte (spec 039)
  depends('pos:ticket');

  const [ticket, settings] = await Promise.all([getTicket(ctx, params.id), getPosSettings(ctx)]);
  if (!ticket) throw error(404, 'Ticket not found');
  // The tender-correction dialog's choices (spec 2026-10-15 S1): enabled
  // methods only — a method retired from settings stays readable, not pickable.
  const methods = settings.methods
    .filter((method) => method.enabled)
    .map((method) => ({ id: method.id, label: method.label }));
  return { pos: { ...ticket, methods, emissionMode: settings.emission.mode } };
};
