import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { rankContacts, createContact, type RankFilters } from '$server/services/crm-contacts.service';

/** GET /api/crm/contacts — ranked, filterable contact list (the core product). */
export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const q = url.searchParams;
  const num = (k: string) => (q.has(k) ? Number(q.get(k)) : undefined);
  const filters: RankFilters = {
    stage: q.get('stage') ?? undefined,
    channel: q.get('channel') ?? undefined,
    tagId: q.get('tagId') ?? undefined,
    search: q.get('search') ?? undefined,
    minScore: num('minScore'),
    maxScore: num('maxScore'),
    sort: (q.get('sort') as RankFilters['sort']) ?? undefined,
    limit: num('limit'),
    offset: num('offset'),
  };
  const contacts = await rankContacts(ctx, filters);
  return json({ contacts });
};

/** POST /api/crm/contacts — manually create a contact. */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await request.json().catch(() => ({}));
  const contact = await createContact(ctx, {
    displayName: typeof body.displayName === 'string' ? body.displayName.trim() : null,
    customFields: body.customFields ?? {},
  });
  return json({ contact }, { status: 201 });
};
