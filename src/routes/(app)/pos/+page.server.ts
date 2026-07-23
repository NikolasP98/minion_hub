import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requiredViewPermForPath } from '$lib/permissions';

/** `/pos` has no view of its own — redirect to the first sub-route the user can view. */
export const load: PageServerLoad = async ({ parent }) => {
  const { permissions, schedulingEnabled } = await parent();
  const perms = permissions.permissions;

  const candidates = [
    '/pos/sell',
    ...(schedulingEnabled ? ['/pos/appointments'] : []),
    '/pos/catalog',
  ];

  for (const href of candidates) {
    const perm = requiredViewPermForPath(href);
    if (!perm || perms.includes(perm)) throw redirect(302, href);
  }

  throw error(403, 'You do not have access to any POS view.');
};
