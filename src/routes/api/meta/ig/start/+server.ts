import type { RequestHandler } from '@sveltejs/kit';
import { error, redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import { requireMetaIgEnv } from '$server/services/meta/meta-connections.service';
import { signOAuthState, OAUTH_STATE_TTL_MS } from '$server/services/meta/oauth-state';
import { hubBaseUrl } from '$server/config/urls';

const STATE_COOKIE = 'meta_ig_oauth_state';

/**
 * GET /api/meta/ig/start — begin the "Instagram API with Instagram Login"
 * flow (spec 2026-07-05-instagram-login-integration §4). A second,
 * independent OAuth family from the FLB pair at `/api/meta/oauth/*`: its own
 * app id/secret, its own authorize host (`www.instagram.com`, not
 * `graph.facebook.com`), and a distinct state cookie name so a concurrent
 * FLB-connect + IG-connect (two tabs) can't clobber each other's state.
 */
export const GET: RequestHandler = async ({ locals, cookies }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  await requireOrgCapability(locals, 'ads', 'manage');

  const { igAppId } = requireMetaIgEnv();
  const userId = locals.user?.supabaseId ?? locals.user?.id ?? '';
  const state = signOAuthState({ org: ctx.tenantId, userId });

  cookies.set(STATE_COOKIE, state, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: !dev,
    maxAge: Math.floor(OAUTH_STATE_TTL_MS / 1000),
  });

  // Must exactly match the Valid OAuth Redirect URI registered on the
  // Instagram App's own product config — a separate registration from the
  // FLB app's redirect URI.
  const redirectUri = `${hubBaseUrl()}/api/meta/ig/callback`;
  const params = new URLSearchParams({
    client_id: igAppId,
    redirect_uri: redirectUri,
    response_type: 'code',
    // Read-only media sync only — no config_id (that's FLB-only).
    scope: 'instagram_business_basic',
    state,
  });
  throw redirect(302, `https://www.instagram.com/oauth/authorize?${params.toString()}`);
};
