import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { updateSupabaseProfile } from '$server/services/supabase-credential';

export const GET: RequestHandler = async ({ locals }) => {
  const user = requireAuth(locals);
  return json({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl ?? null,
    role: user.role,
    createdAt: user.createdAt ?? null,
  });
};

/**
 * PATCH /api/me — self-serve profile update. The current user can change their
 * own display name and avatar. Avatar bytes are uploaded separately via
 * POST /api/files (category 'avatars'); pass the returned file id as
 * `avatarFileId` and we persist the stable /api/files/<id>/raw reference.
 * Writes to the canonical Supabase profiles table.
 */
export const PATCH: RequestHandler = async ({ locals, request }) => {
  const user = requireAuth(locals);
  const supabaseId = user.supabaseId;
  if (!supabaseId) throw error(400, 'no supabase profile for this user');

  const body = (await request.json().catch(() => ({}))) as {
    displayName?: unknown;
    avatarFileId?: unknown;
    avatarUrl?: unknown;
  };

  const patch: { displayName?: string | null; avatarUrl?: string | null } = {};

  if (typeof body.displayName === 'string') {
    const name = body.displayName.trim();
    if (name.length === 0 || name.length > 120) throw error(400, 'invalid displayName');
    patch.displayName = name;
  }

  if (typeof body.avatarFileId === 'string' && body.avatarFileId.length > 0) {
    patch.avatarUrl = `/api/files/${body.avatarFileId}/raw`;
  } else if (body.avatarUrl === null) {
    patch.avatarUrl = null; // explicit avatar removal
  } else if (typeof body.avatarUrl === 'string' && /^https?:\/\//.test(body.avatarUrl)) {
    patch.avatarUrl = body.avatarUrl;
  }

  if (Object.keys(patch).length === 0) throw error(400, 'nothing to update');

  const ok = await updateSupabaseProfile(supabaseId, patch);
  if (!ok) throw error(500, 'profile update failed');

  return json({ ok: true });
};
