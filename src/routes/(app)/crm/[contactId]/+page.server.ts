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

  return {
    contact: record.contact,
    identities: record.identities,
    stats: record.stats,
    score: ranked[0] ?? null,
    timeline,
    contactTags,
    allTags,
  };
};
