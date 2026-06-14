import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { rankContacts, listTags, type RankFilters } from '$server/services/crm-contacts.service';

export const load: PageServerLoad = async ({ locals, url, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('crm:contacts');

  const q = url.searchParams;
  const num = (k: string) => (q.has(k) ? Number(q.get(k)) : undefined);
  const filters: RankFilters = {
    stage: q.get('stage') ?? undefined,
    channel: q.get('channel') ?? undefined,
    tagId: q.get('tagId') ?? undefined,
    search: q.get('search') ?? undefined,
    minScore: num('minScore'),
    sort: (q.get('sort') as RankFilters['sort']) ?? undefined,
    // Show the full roster (FACES alone is ~1.6k). Service caps at 5000; if an
    // org ever exceeds that we add pagination, but a flat list is fine at this scale.
    limit: 5000,
  };

  const [contacts, tags] = await Promise.all([rankContacts(ctx, filters), listTags(ctx)]);
  return { contacts, tags, filters: { ...filters, limit: undefined } };
};
