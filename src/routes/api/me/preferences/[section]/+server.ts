import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { getCoreDb } from '$server/db/pg-client';
import { upsertUserPreference } from '$server/services/user-preferences.service';

const VALID_SECTIONS = new Set(['theme', 'crt', 'bgPattern', 'sparklineStyle', 'logo', 'locale']);

export const PUT: RequestHandler = async ({ locals, params, request }) => {
  const user = requireAuth(locals);
  const { section } = params;
  if (!section || !VALID_SECTIONS.has(section)) {
    throw error(400, `Invalid preference section: ${section}`);
  }
  // Preferences are keyed by profile_id (Supabase auth uuid) in Postgres.
  if (!user.supabaseId) throw error(409, 'No Supabase identity for this user');
  const body = await request.json();
  await upsertUserPreference(getCoreDb(), user.supabaseId, section, body.value);
  return json({ ok: true });
};
