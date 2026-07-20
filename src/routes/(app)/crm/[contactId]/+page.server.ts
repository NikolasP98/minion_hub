import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { ownerFilter, shouldMaskSensitive } from '$server/services/rbac.service';
import {
  getContact,
  getContactTimeline,
  getContactTags,
  rankContacts,
  listTags,
} from '$server/services/crm-contacts.service';
import { evaluateTagRule } from '$server/services/crm-scoring';
import { contactFinanceSummary } from '$server/services/crm-finance.service';
import { contactConnections } from '$server/services/connections.service';
import { contactJourney } from '$server/services/crm-journey.service';
import { uuidParamOr404 } from '$server/utils/uuid-param';

export const load: PageServerLoad = async ({ locals, params, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('crm:contact');
  const id = uuidParamOr404(params.contactId);

  // Record-level (if-owner) scope: a scoped caller can only open contacts they
  // own — a non-owned id 404s rather than leaking existence. Field-level scope
  // masks the contact's PII (phone/email) below the crm sensitive field level.
  const [ownerId, maskPii] = await Promise.all([
    ownerFilter(locals, 'crm'),
    shouldMaskSensitive(locals, 'crm'),
  ]);
  const record = await getContact(ctx, id, ownerId, maskPii);
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

  const [finance, connections, journey] = await Promise.all([
    contactFinanceSummary(ctx, id),
    contactConnections(ctx, id),
    contactJourney(ctx, id),
  ]);

  return {
    contact: record.contact,
    identities: record.identities,
    stats: record.stats,
    // Party-spine identity (doc_number / dob / derived age) — the authority for
    // DNI + date of birth on this page, replacing custom_fields.dni / .edad.
    party: record.party,
    score,
    timeline,
    contactTags,
    allTags,
    autoTags,
    finance,
    connections,
    journey,
  };
};
