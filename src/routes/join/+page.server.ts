import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { consumeLink } from '$server/services/join/links.service';

export const load: PageServerLoad = async ({ locals, url }) => {
  const user = requireAuth(locals);
  const token = url.searchParams.get('token');

  if (token) {
    try {
      await consumeLink(token, { id: user.id, email: user.email, displayName: user.displayName });
    } catch {
      return { linkError: true, email: user.email, displayName: user.displayName };
    }
    throw redirect(303, '/');
  }
  return { linkError: false, email: user.email, displayName: user.displayName };
};
