import type { RequestHandler } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import { verifyOAuthState } from '$server/services/meta/oauth-state';
import { createConnectionFromOAuth, enqueueInitialSyncJobs } from '$server/services/meta/meta-connections.service';
import { hubBaseUrl } from '$server/config/urls';

const STATE_COOKIE = 'meta_oauth_state';

/**
 * GET /api/meta/oauth/callback — the only redirect URI registered on the
 * FLB config (spec §5 LIVE FACTS): https://hub.minion-ai.org/api/meta/oauth/callback
 *
 * Never logs the exchanged token; redirect targets carry only a `reason`
 * code, never Graph error text or any token material.
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
    const redirectUri = `${hubBaseUrl()}/api/meta/oauth/callback`;
    const result = await createConnectionFromOAuth(ctx, {
      code,
      redirectUri,
      connectedBy: locals.user?.supabaseId ?? locals.user?.id ?? '',
    });

    if (!result.ok) {
      console.error('[meta-oauth-callback] token exchange failed:', result.error);
      throw redirect(303, '/ads/settings?connected=0&reason=exchange_failed');
    }
    console.info(
      `[meta-oauth-callback] org=${ctx.tenantId} connection=${result.connectionId} pages=${result.pagesFound} (${result.pagePath}) ig=${result.igFound} adAccounts=${result.adAccountsFound}`,
    );

    await enqueueInitialSyncJobs(ctx);
    throw redirect(303, '/ads/settings?connected=1');
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err && 'location' in err) throw err; // rethrow SvelteKit redirect
    console.error('[meta-oauth-callback] unexpected failure:', err);
    throw redirect(303, '/ads/settings?connected=0&reason=server_error');
  }
};
