import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import { ownerFilter } from '$server/services/rbac.service';
import { isModuleEnabled } from '$server/services/modules.service';
import { listIssues, issueStats, agreementStatus } from '$server/services/support.service';
import { getContact } from '$server/services/crm-contacts.service';

export const load: PageServerLoad = async ({ locals, depends, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'support'))) throw error(404, 'Support module disabled');
  depends('support:list');

  // Cross-module nav: ?contact= filters to one contact's tickets (Connections
  // panel), ?new=1 opens the create form pre-bound to that contact.
  const contact = url.searchParams.get('contact') ?? undefined;
  const openCreate = url.searchParams.get('new') === '1';

  const [raw, stats, contactRec] = await Promise.all([
    listIssues(ctx, {
      status: 'open_all',
      crmContactId: contact,
      limit: 200,
      ownerId: await ownerFilter(locals, 'support'),
    }),
    issueStats(ctx),
    contact ? getContact(ctx, contact) : Promise.resolve(null),
  ]);
  // SLA agreement state is derived (never stored) — compute it once here so the
  // client never imports the server-only service.
  const now = new Date();
  const issues = raw.map((i) => ({ ...i, sla: agreementStatus(i, now) }));
  return {
    issues,
    stats,
    contactId: contact ?? null,
    contactName: contactRec?.contact?.displayName ?? null,
    openCreate,
  };
};
