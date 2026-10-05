import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { hasAnyMembership } from '$server/services/join/membership';
import { getPendingRequestsForUser } from '$server/services/join/requests.service';

/** A waiting screen is evidence of the caller's requests, not a generic success claim. */
export const load: PageServerLoad = async ({ locals }) => {
  const user = requireAuth(locals);
  const pending = await getPendingRequestsForUser(user.id);
  if (pending.kind === 'none' && user.supabaseId && (await hasAnyMembership(user.supabaseId)))
    throw redirect(303, '/');
  return { pending };
};
