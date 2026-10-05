import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { requireAuth } from '$server/auth/authorize';
import { resolveSupabaseTenant } from '$server/auth/supabase-bridge.runtime';

/**
 * Persist the user's active organization (the org switcher).
 *
 * In Supabase mode there is no Better-Auth session row, so the legacy
 * `authClient.organization.setActive()` (which mutates session.activeOrganizationId)
 * is a no-op — the switch never took effect. This endpoint stores the selection
 * in an `active_org` cookie, which `resolveIdentity` reads and passes to
 * `resolveSupabaseTenant` as the preferred org on every subsequent request.
 *
 * The selection is validated against the user's actual memberships, so a user
 * can't pin an org they don't belong to.
 */
export const POST: RequestHandler = async ({ locals, request, cookies }) => {
  const user = requireAuth(locals);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'invalid JSON body');
  }
  const orgId = (body as { orgId?: unknown })?.orgId;
  if (!orgId || typeof orgId !== 'string') throw error(400, 'orgId required');

  // Browser organization authority comes only from a current canonical
  // membership. There is no legacy session provider that can skip this check.
  if (!user.supabaseId) throw error(403, 'canonical identity required');
  const resolved = await resolveSupabaseTenant(user.supabaseId, orgId);
  if (resolved?.orgId !== orgId) throw error(403, 'not a member of that organization');

  cookies.set('active_org', orgId, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: !dev,
    maxAge: 60 * 60 * 24 * 365,
  });

  return json({ ok: true, orgId });
};
