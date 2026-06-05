/**
 * Remote functions for the current user's self-serve profile.
 *
 * Replaces the client `fetch('/api/me', { method: 'PATCH' })` glue in
 * ProfileCard.svelte and AvatarUpload.svelte. The `/api/me` GET stays a
 * `+server.ts` route — `user` is auth-derived and served via the `(app)` layout
 * bundle (`page.data.user`); we do NOT client-fetch it (see the canonical
 * load-flow note in CLAUDE.md).
 *
 * Mirrors the validation + write path of `src/routes/api/me/+server.ts` PATCH.
 * Callers should `invalidate('app:user')` after a successful write to refresh
 * the layout-bundled user (the documented post-mutation pattern).
 */
import { command } from '$app/server';
import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { currentUser } from '$server/remote/guard';
import { updateSupabaseProfile } from '$server/services/supabase-credential';

const updateProfileInput = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  /** id returned by POST /api/files (category 'avatars'); stored as a stable /raw ref. */
  avatarFileId: z.string().min(1).optional(),
  /** explicit avatar removal */
  removeAvatar: z.boolean().optional(),
  /** absolute http(s) avatar URL (e.g. OAuth provider photo) */
  avatarUrl: z.string().regex(/^https?:\/\//).optional(),
});

/** Update the current user's display name and/or avatar. Returns `{ ok: true }`. */
export const updateProfile = command(updateProfileInput, async (input) => {
  const user = currentUser();
  const supabaseId = user.supabaseId;
  if (!supabaseId) error(400, 'no supabase profile for this user');

  const patch: { displayName?: string | null; avatarUrl?: string | null } = {};

  if (input.displayName !== undefined) {
    patch.displayName = input.displayName;
  }

  if (input.avatarFileId) {
    patch.avatarUrl = `/api/files/${input.avatarFileId}/raw`;
  } else if (input.removeAvatar) {
    patch.avatarUrl = null;
  } else if (input.avatarUrl) {
    patch.avatarUrl = input.avatarUrl;
  }

  if (Object.keys(patch).length === 0) error(400, 'nothing to update');

  const ok = await updateSupabaseProfile(supabaseId, patch);
  if (!ok) error(500, 'profile update failed');

  return { ok: true as const };
});
