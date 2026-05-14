import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { loadUserPreferences } from '$server/services/preferences.service';

export const GET: RequestHandler = async ({ locals }) => {
  const user = requireAuth(locals);
  return json(await loadUserPreferences(locals, user.id));
};
