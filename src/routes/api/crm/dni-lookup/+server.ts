import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { dniPreview, isDni8 } from '@minion-stack/crm-sdk';
import { getCoreCtx } from '$server/auth/core-ctx';
import { applyContactDni } from '$server/services/party.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/crm/dni-lookup — { dni: "12345678", contactId?: uuid }
 * Without `contactId`: read-only registry preview, returns the fields the CRM
 * would offer to fill (name/sex/dob/age) WITHOUT writing anything.
 * With `contactId`: ALSO commits them onto that contact's party spine (the
 * "apply" half — doc_number/dob/sex/name are party columns the details-form
 * custom_fields PATCH cannot reach, which is why an applied hit used to vanish
 * on save). POST (not GET) so the central apiWriteCapability gate covers it
 * (crm:edit) and the DNI stays out of URLs/logs.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  const apiKey = env.PERUDEVS_API_KEY;
  if (!apiKey) throw error(503, 'DNI lookup not configured');

  const body = (await request.json().catch(() => null)) as {
    dni?: unknown;
    contactId?: unknown;
  } | null;
  const dni = typeof body?.dni === 'string' ? body.dni.trim() : '';
  if (!isDni8(dni)) throw error(400, 'DNI must be exactly 8 digits');
  const contactId = typeof body?.contactId === 'string' ? body.contactId : null;

  if (contactId) {
    if (!UUID_RE.test(contactId)) throw error(400, 'Invalid contact id');
    const applied = await applyContactDni(ctx, contactId, dni, apiKey);
    if (!applied.ok) {
      if (applied.reason === 'not_found') throw error(404, 'Contact not found');
      if (applied.reason === 'conflict') throw error(409, 'That DNI belongs to another contact');
      throw error(502, 'Registry lookup failed');
    }
    return json({ found: applied.verified, applied: true });
  }

  const result = await dniPreview(dni, apiKey);
  if (result.status === 'error') throw error(502, 'Registry lookup failed');
  if (result.status === 'not_found') return json({ found: false });
  return json({ found: true, ...result.preview });
};
