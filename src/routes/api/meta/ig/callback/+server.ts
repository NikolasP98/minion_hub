import type { RequestHandler } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import { verifyOAuthState } from '$server/services/meta/oauth-state';
import { createIgConnectionFromOAuth, enqueueInitialSyncJobs } from '$server/services/meta/meta-connections.service';
import { hubBaseUrl } from '$server/config/urls';

const STATE_COOKIE = 'meta_ig_oauth_state';

/**
 * GET /api/meta/ig/callback — the only redirect URI registered on the
 * Instagram App's own product config (spec 2026-07-05-instagram-login-integration §4).
 *
 * Never logs the exchanged token; redirect targets carry only a `reason`
 * code, never Graph/Instagram error text or any token material. Same
 * `enqueueInitialSyncJobs` reuse as the FLB callback: jobs are
 * (orgId, kind)-scoped, not connection-scoped, so a `posts` job already
 * covers this connection's media once `runJob` picks it up (see
 * meta-sync.service.ts's connection-by-kind selection).
 */
export const GET: RequestHandler = async ({ locals, url, cookies }) => {
  const clearStateCookie = () => cookies.delete(STATE_COOKIE, { path: '/' });

  if (url.searchParams.get('error')) {
    clearStateCookie();
    throw redirect(303, '/ads/settings?connected=0&reason=denied');
  }

  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  const cookieState = cookies.get(STATE_COOKIE);
  const verified = verifyOAuthState(stateParam, cookieState);
  clearStateCookie(); // state is single-use regardless of outcome

  if (!verified.ok) {
    throw redirect(303, `/ads/settings?connected=0&reason=state_${verified.reason}`);
  }
  if (!code) {
    throw redirect(303, '/ads/settings?connected=0&reason=missing_code');
  }

  const ctx = await getCoreCtx(locals);
  if (!ctx || ctx.tenantId !== verified.payload.org) {
    throw redirect(303, '/ads/settings?connected=0&reason=org_mismatch');
  }
  await requireOrgCapability(locals, 'ads', 'manage');

  try {
    const redirectUri = `${hubBaseUrl()}/api/meta/ig/callback`;
    const result = await createIgConnectionFromOAuth(ctx, {
      code,
      redirectUri,
      connectedBy: locals.user?.supabaseId ?? locals.user?.id ?? '',
    });

    if (!result.ok) {
      console.error('[meta-ig-callback] token exchange failed:', result.error);
      throw redirect(303, '/ads/settings?connected=0&reason=exchange_failed');
    }
    console.info(`[meta-ig-callback] org=${ctx.tenantId} connection=${result.connectionId}`);

    await enqueueInitialSyncJobs(ctx);
    throw redirect(303, '/ads/settings?connected=1');
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err && 'location' in err) throw err; // rethrow SvelteKit redirect
    console.error('[meta-ig-callback] unexpected failure:', err);
    throw redirect(303, '/ads/settings?connected=0&reason=server_error');
  }
};
