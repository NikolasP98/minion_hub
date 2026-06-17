import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import {
  getContact,
  getContactTimeline,
  getContactTags,
  rankContacts,
  listTags,
} from '$server/services/crm-contacts.service';
import { evaluateTagRule } from '$server/services/crm-scoring';
import { contactFinanceSummary } from '$server/services/crm-finance.service';

export const load: PageServerLoad = async ({ locals, params, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('crm:contact');
  const id = params.contactId;

  const record = await getContact(ctx, id);
  if (!record) throw error(404, 'Contact not found');

  const [timeline, contactTags, allTags, ranked] = await Promise.all([
    getContactTimeline(ctx, id, 200),
    getContactTags(ctx, id),
    listTags(ctx),
    rankContacts(ctx, { contactId: id, limit: 1 }),
  ]);

  // Auto-tags are derived live from the scored row (never stored as contact_tags).
  const score = ranked[0] ?? null;
  const autoTags = score
    ? allTags.filter(
        (t) => t.kind === 'auto' && t.rule != null && evaluateTagRule(t.rule, score as never),
      )
    : [];

  const finance = await contactFinanceSummary(ctx, id);

  return {
    contact: record.contact,
    identities: record.identities,
    stats: record.stats,
    score,
    timeline,
    contactTags,
    allTags,
    autoTags,
    finance,
  };
};
