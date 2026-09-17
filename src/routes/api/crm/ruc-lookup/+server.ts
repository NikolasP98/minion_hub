import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { lookupRucConfigured } from '$server/services/ruc-registry';

/**
 * POST /api/crm/ruc-lookup — { ruc: "20611172967" }
 * Read-only SUNAT registry lookup, mirroring /api/crm/dni-lookup: returns the
 * fields a form would offer to fill WITHOUT writing anything. POST (not GET) so
 * the central apiWriteCapability gate covers it and the RUC stays out of
 * URLs/logs. The create path re-verifies server-side (see ruc-registry.ts).
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');

  const body = (await request.json().catch(() => null)) as { ruc?: unknown } | null;
  const ruc = typeof body?.ruc === 'string' ? body.ruc.trim() : '';
  if (!/^\d{11}$/.test(ruc)) throw error(400, 'RUC must be exactly 11 digits');

  const result = await lookupRucConfigured(ruc);
  if (result.status === 'unconfigured') throw error(503, 'RUC lookup not configured');
  if (result.status === 'error') throw error(502, 'Registry lookup failed');
  if (result.status === 'not_found') return json({ found: false });
  return json({ found: true, ...result.company });
};
