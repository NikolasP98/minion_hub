import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import {
  listAvailableSharedIdentities,
  subscribeToIdentity,
} from '$server/services/shared-identity.service';

/**
 * GET  /api/shared-identities            → { available: AvailableSharedIdentity[] }
 *   Shared identities the current user may opt into (each flagged `subscribed`).
 * POST /api/shared-identities { identityId } → { ok: true }
 *   Subscribe the current user (availability re-validated server-side).
 */
export const GET: RequestHandler = async ({ locals }) => {
  const user = requireAuth(locals);
  const available = await listAvailableSharedIdentities(user.id);
  return json({ available });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  const user = requireAuth(locals);
  const b = (await request.json().catch(() => ({}))) as { identityId?: string };
  if (!b.identityId) throw error(400, 'identityId is required');
  try {
    await subscribeToIdentity(user.id, b.identityId);
    return json({ ok: true });
  } catch (e) {
    throw error(400, e instanceof Error ? e.message : 'failed to subscribe');
  }
};
