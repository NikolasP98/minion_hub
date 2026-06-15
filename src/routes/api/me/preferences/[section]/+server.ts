import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { getCoreDb } from '$server/db/pg-client';
import { upsertUserPreference } from '$server/services/user-preferences.service';

const VALID_SECTIONS = new Set([
  'theme',
  'crt',
  'bgPattern',
  'sparklineStyle',
  'logo',
  'locale',
  'landingPage',
]);

export const PUT: RequestHandler = async ({ locals, params, request }) => {
  const user = requireAuth(locals);
  const { section } = params;
  if (!section || !VALID_SECTIONS.has(section)) {
    throw error(400, `Invalid preference section: ${section}`);
  }
  // Preferences are keyed by profile_id (Supabase auth uuid) in Postgres.
  if (!user.supabaseId) throw error(409, 'No Supabase identity for this user');
  const body = await request.json();

  // The landing page is consumed by the "/" redirect in hooks.server.ts, so a
  // poisoned value is an open-redirect vector. Constrain it to a safe
  // root-relative path at write time (defense in depth — the redirect also
  // re-validates). Disallows absolute URLs, protocol-relative `//host`, and
  // backslash tricks; allows query strings (e.g. /agents?archetype=copilot).
  if (section === 'landingPage') {
    const v = body.value;
    if (typeof v !== 'string' || !/^\/(?![/\\])[A-Za-z0-9/_\-?=&.]*$/.test(v)) {
      throw error(400, 'Invalid landing page path');
    }
  }

  await upsertUserPreference(getCoreDb(), user.supabaseId, section, body.value);
  return json({ ok: true });
};
