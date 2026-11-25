import type { PageServerLoad } from './$types';
import { requireOrgCapability } from '$server/services/rbac.service';
import { requireDataset } from '$server/auth/dataset-ctx';
import {
  getLockPolicyFor,
  isOrgOwner,
  listLockEvents,
} from '$server/services/record-locks.service';

/** Settings → Record locks (spec 140): the organization's lock rules and the audit list. */
export const load: PageServerLoad = async ({ locals, depends, url }) => {
  await requireOrgCapability(locals, 'settings', 'manage');
  const ctx = await requireDataset(locals, 'settings');
  depends('settings:record-locks');
  // "Cargar más" asks for 100 more rows through `?events=`; capped so the list stays one query.
  const asked = Number(url.searchParams.get('events'));
  const eventsLimit = Number.isInteger(asked) && asked >= 100 ? Math.min(asked, 500) : 100;
  const [policy, isOwner, events] = await Promise.all([
    getLockPolicyFor(ctx),
    isOrgOwner(ctx),
    listLockEvents(ctx, { limit: eventsLimit }),
  ]);
  return { policy, isOwner, events, eventsLimit };
};
