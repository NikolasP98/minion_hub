import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { ensureParty, searchParties } from '$server/services/party.service';

/** GET /api/crm/parties?q=&type=person,company — typeahead for party pickers. */
export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const q = url.searchParams.get('q') ?? '';
  const typeParam = url.searchParams.get('type');
  const types = typeParam ? typeParam.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
  return json(await searchParties(ctx, q, { types }));
};

const postSchema = z.object({
  name: z.string().min(1).max(500),
  phone: z.string().max(50).nullable().optional(),
  email: z.string().max(500).nullable().optional(),
  docType: z.string().max(20).nullable().optional(),
  docNumber: z.string().max(20).nullable().optional(),
  type: z.enum(['person', 'company']).optional(),
});

/** POST /api/crm/parties — find-or-create a party (POS quick-add path).
 *  Dedups on docNumber then phone9 via ensureParty; gated centrally as
 *  crm:create (CREATE_COLLECTION_ENDPOINTS). */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const b = await parseBody(request, postSchema);
  const party = await ensureParty(ctx, {
    type: b.type ?? 'person',
    name: b.name,
    phone: b.phone ?? null,
    email: b.email ?? null,
    docType: b.docNumber ? (b.docType ?? 'DNI') : null,
    docNumber: b.docNumber ?? null,
  });
  return json({ ok: true, party: { id: party.id, name: party.name, phone9: party.phone9, docNumber: party.docNumber } }, { status: 201 });
};
