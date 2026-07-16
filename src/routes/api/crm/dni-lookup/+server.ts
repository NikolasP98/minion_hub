import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { dniPreview, isDni8 } from '@minion-stack/crm-sdk';
import { getCoreCtx } from '$server/auth/core-ctx';

/**
 * POST /api/crm/dni-lookup — { dni: "12345678" }
 * Read-only registry lookup: returns the fields the CRM would offer to fill
 * (name/sex/dob/age) WITHOUT writing anything. Backs the "check this ID and
 * offer to fill" affordance in the contact create/edit forms. POST (not GET) so
 * the central apiWriteCapability gate covers it (crm:edit) and the DNI stays out
 * of URLs/logs.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  const apiKey = env.PERUDEVS_API_KEY;
  if (!apiKey) throw error(503, 'DNI lookup not configured');

  const body = (await request.json().catch(() => null)) as { dni?: unknown } | null;
  const dni = typeof body?.dni === 'string' ? body.dni.trim() : '';
  if (!isDni8(dni)) throw error(400, 'DNI must be exactly 8 digits');

  const result = await dniPreview(dni, apiKey);
  if (result.status === 'error') throw error(502, 'Registry lookup failed');
  if (result.status === 'not_found') return json({ found: false });
  return json({ found: true, ...result.preview });
};
