import { getDb } from '$server/db/client';
import { getUserPreferences } from './user-preferences.service';
import type { LoadCtx } from './types';

export interface PreferencesLoadResult {
  preferences: Record<string, unknown>;
}

/**
 * Load the authenticated user's preferences map. Mirrors
 * `GET /api/me/preferences` response shape: `{ preferences }`.
 *
 * Callable from both `+server.ts` and `+layout.server.ts`. The caller is
 * responsible for gating on `requireAuth(locals)` first; this helper
 * intentionally does not read auth state and only needs the user id.
 */
export async function loadUserPreferences(
  _ctx: LoadCtx,
  userId: string,
): Promise<PreferencesLoadResult> {
  const db = getDb();
  const preferences = await getUserPreferences(db, userId);
  return { preferences };
}
