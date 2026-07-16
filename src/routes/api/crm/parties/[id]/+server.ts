import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { setPartyDniVerified } from '$server/services/party.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PATCH /api/crm/parties/[id] — { dniVerified: boolean }
 * The CRM customers-table verified-checkmark toggle. Write capability is gated
 * centrally by apiWriteCapability ('/api/crm' prefix) in hooks.server.ts.
 */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!UUID_RE.test(params.id ?? '')) throw error(400, 'Invalid party id');

  const body = (await request.json().catch(() => null)) as { dniVerified?: unknown } | null;
  if (!body || typeof body.dniVerified !== 'boolean') {
    throw error(400, 'dniVerified boolean required');
  }

  const ok = await setPartyDniVerified(ctx, params.id!, body.dniVerified);
  if (!ok) throw error(404, 'Party not found');
  return json({ ok: true, dniVerified: body.dniVerified });
};
