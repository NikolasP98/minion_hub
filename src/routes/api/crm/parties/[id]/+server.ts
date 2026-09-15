import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { setPartyDniVerified, setPartyPhone } from '$server/services/party.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PATCH /api/crm/parties/[id] — { dniVerified: boolean } and/or { phone: string }
 *
 * The CRM's ONE party-edit path: the customers-table verified checkmark, and
 * the phone the POS customer card can now fill in for a client already on file
 * (an appointment reminder has no recipient without it). Write capability is
 * gated centrally as `crm:edit` by apiWriteCapability ('/api/crm' prefix) in
 * hooks.server.ts — the same gate the CRM's own edits pass through.
 */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!UUID_RE.test(params.id ?? '')) throw error(400, 'Invalid party id');

  const body = (await request.json().catch(() => null)) as {
    dniVerified?: unknown;
    phone?: unknown;
  } | null;
  if (!body) throw error(400, 'Body required');

  const wantsVerified = body.dniVerified !== undefined;
  const wantsPhone = body.phone !== undefined;
  if (!wantsVerified && !wantsPhone) throw error(400, 'dniVerified or phone required');
  if (wantsVerified && typeof body.dniVerified !== 'boolean') {
    throw error(400, 'dniVerified boolean required');
  }
  if (wantsPhone && (typeof body.phone !== 'string' || body.phone.length > 50)) {
    throw error(400, 'phone string required');
  }

  const out: { ok: true; dniVerified?: boolean; phone?: string } = { ok: true };

  if (wantsVerified) {
    const ok = await setPartyDniVerified(ctx, params.id!, body.dniVerified as boolean);
    if (!ok) throw error(404, 'Party not found');
    out.dniVerified = body.dniVerified as boolean;
  }
  if (wantsPhone) {
    // null means "unusable number, or no such party in this org" — a 400 for the
    // first would leak nothing extra, so both answer the same way the verified
    // toggle does.
    const stored = await setPartyPhone(ctx, params.id!, body.phone as string);
    if (!stored) throw error(400, 'Party not found or phone unusable');
    out.phone = stored;
  }

  return json(out);
};
