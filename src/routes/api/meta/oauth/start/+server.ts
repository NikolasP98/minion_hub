import type { RequestHandler } from '@sveltejs/kit';
import { error, redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import { requireMetaEnv } from '$server/services/meta/meta-connections.service';
import { signOAuthState, OAUTH_STATE_TTL_MS } from '$server/services/meta/oauth-state';
import { hubBaseUrl } from '$server/config/urls';

const STATE_COOKIE = 'meta_oauth_state';

/**
 * GET /api/meta/oauth/start — begin the Meta Facebook-Login-for-Business
 * flow for the caller's active org (spec §5). The acting org is the
 * session's resolved tenant (`getCoreCtx`/`requireOrgCapability`), never a
 * client-supplied `?org=` param — same IDOR-avoidance pattern as every other
 * org-scoped route in this codebase (e.g. `/api/active-org`).
 */
export const GET: RequestHandler = async ({ locals, cookies }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  await requireOrgCapability(locals, 'ads', 'manage');

  const { appId, loginConfigId } = requireMetaEnv();
  const userId = locals.user?.supabaseId ?? locals.user?.id ?? '';
  const state = signOAuthState({ org: ctx.tenantId, userId });

  cookies.set(STATE_COOKIE, state, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: !dev,
    maxAge: Math.floor(OAUTH_STATE_TTL_MS / 1000),
  });

  // Redirect URI is built from the canonical public origin config, never
  // from the request Host (spec §5 — open-redirect + signature hygiene).
  // It must exactly match the one Valid OAuth Redirect URI registered on
  // the FLB config: https://hub.minion-ai.org/api/meta/oauth/callback
  const redirectUri = `${hubBaseUrl()}/api/meta/oauth/callback`;
  const params = new URLSearchParams({
    client_id: appId,
    config_id: loginConfigId,
    redirect_uri: redirectUri,
    state,
    response_type: 'code',
  });
  throw redirect(302, `https://www.facebook.com/v23.0/dialog/oauth?${params.toString()}`);
};
