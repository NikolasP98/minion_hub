import { getCoreDb } from '$server/db/pg-client';
import { getUserPreferences } from './user-preferences.service';
import type { LoadCtx } from './types';

export interface PreferencesLoadResult {
  preferences: Record<string, unknown>;
}

/**
 * Load the authenticated user's preferences map. Mirrors
 * `GET /api/me/preferences` response shape: `{ preferences }`.
 *
 * Preferences live in Supabase Postgres keyed by `profile_id` (profiles.id),
 * so the caller passes `locals.user.supabaseId`. If there's no Supabase
 * identity (e.g. self-host/Better-Auth mode), returns an empty map rather than
 * issuing a uuid query that would throw — this load runs on every app page.
 *
 * Callable from both `+server.ts` and `+layout.server.ts`. The caller is
 * responsible for gating on `requireAuth(locals)` first.
 */
export async function loadUserPreferences(
  _ctx: LoadCtx,
  profileId: string | undefined,
): Promise<PreferencesLoadResult> {
  if (!profileId) return { preferences: {} };
  const preferences = await getUserPreferences(getCoreDb(), profileId);
  return { preferences };
}
