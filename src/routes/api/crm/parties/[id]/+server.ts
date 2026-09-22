import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import {
  contactIdForParty,
  getParty,
  setPartyDniVerified,
  setPartyDob,
  setPartyDocument,
  setPartyPhone,
} from '$server/services/party.service';
import { hasOrgCapability, ownerFilter } from '$server/services/rbac.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/crm/parties/[id] — the picker-row shape of ONE party.
 *
 * The POS customer card hydrates a client it was handed by id only (booking →
 * charge handoff, restored selection) from the spine, so its identity gate
 * reads what the CRM holds rather than what a payload happened to carry. Same
 * read gate as the `GET /api/crm/parties` search the same card already uses.
 */
export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!UUID_RE.test(params.id ?? '')) throw error(400, 'Invalid party id');
  const p = await getParty(ctx, params.id!);
  if (!p) throw error(404, 'Party not found');
  const canViewCrm = await hasOrgCapability(locals, 'crm', 'view');
  const crmOwnerId = canViewCrm ? await ownerFilter(locals, 'crm') : undefined;
  return json({
    id: p.id,
    name: p.name,
    type: p.type,
    email: p.email,
    docNumber: p.docNumber,
    phone9: p.phone9,
    dniVerified: p.dniVerified,
    contactId: canViewCrm ? await contactIdForParty(ctx, p.id, crmOwnerId) : null,
  });
};

/**
 * PATCH /api/crm/parties/[id] — { dniVerified: boolean } and/or { phone: string }
 * and/or { docNumber: string }
 *
 * The CRM's ONE party-edit path: the customers-table verified checkmark, and
 * the phone / identity document the POS customer card can fill in for a client
 * already on file (a reminder has no recipient without the phone; an org that
 * requires a DNI/RUC per ticket cannot charge without the document). Write
 * capability is gated centrally as `crm:edit` by apiWriteCapability ('/api/crm'
 * prefix) in hooks.server.ts — the same gate the CRM's own edits pass through.
 */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!UUID_RE.test(params.id ?? '')) throw error(400, 'Invalid party id');

  const body = (await request.json().catch(() => null)) as {
    dniVerified?: unknown;
    phone?: unknown;
    docNumber?: unknown;
    dob?: unknown;
  } | null;
  if (!body) throw error(400, 'Body required');

  const wantsVerified = body.dniVerified !== undefined;
  const wantsPhone = body.phone !== undefined;
  const wantsDoc = body.docNumber !== undefined;
  const wantsDob = body.dob !== undefined;
  if (!wantsVerified && !wantsPhone && !wantsDoc && !wantsDob) {
    throw error(400, 'dniVerified, phone, docNumber or dob required');
  }
  if (wantsVerified && typeof body.dniVerified !== 'boolean') {
    throw error(400, 'dniVerified boolean required');
  }
  if (wantsPhone && (typeof body.phone !== 'string' || body.phone.length > 50)) {
    throw error(400, 'phone string required');
  }
  if (wantsDoc && (typeof body.docNumber !== 'string' || body.docNumber.length > 20)) {
    throw error(400, 'docNumber string required');
  }
  if (wantsDob && (typeof body.dob !== 'string' || body.dob.length !== 10)) {
    throw error(400, 'dob YYYY-MM-DD required');
  }

  const out: {
    ok: true;
    dniVerified?: boolean;
    phone?: string;
    docNumber?: string;
    dob?: string;
  } = { ok: true };

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
  if (wantsDoc) {
    // Distinct statuses on purpose: the card tells the cashier whether to
    // retype (400) or to pick the client that already holds it (409).
    const r = await setPartyDocument(ctx, params.id!, body.docNumber as string);
    if (!r.ok) {
      if (r.reason === 'taken') throw error(409, 'document_taken');
      if (r.reason === 'invalid') throw error(400, 'document_invalid');
      throw error(404, 'Party not found');
    }
    out.docNumber = r.docNumber;
  }
  if (wantsDob) {
    const r = await setPartyDob(ctx, params.id!, body.dob as string);
    if (r === 'invalid') throw error(400, 'dob_invalid');
    if (r === 'not_found') throw error(404, 'Party not found');
    out.dob = body.dob as string;
  }

  return json(out);
};
