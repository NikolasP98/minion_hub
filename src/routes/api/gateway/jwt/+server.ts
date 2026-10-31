import type { RequestHandler } from '@sveltejs/kit';
import { json, error, isHttpError } from '@sveltejs/kit';
import * as Sentry from '@sentry/sveltekit';
import { and, eq } from 'drizzle-orm';
import { userServers } from '@minion-stack/db/schema';
import { browserSharedTokenOff } from '$lib/gateway-browser-token';
import {
  GatewayJwtAccessDenied,
  gatewayAudience,
  issueGatewayJwt,
} from '$server/services/gateway-jwt.service';
import { getGatewayUrlForOrg, userHasGatewayAccess } from '$server/services/gateway.pg.service';
import { requireAuth } from '$server/auth/authorize';
import { getTenantCtx } from '$server/auth/tenant-ctx';

/**
 * Cookie-authenticated issuance; every outcome is private and non-cacheable.
 *
 * `?gatewayId=` binds the JWT to that gateway (`aud = gw:<host[:port]>`, spec
 * 045 §3.1). The gateway must belong to the active org and, for anyone but a
 * platform admin, be linked to the caller — the same gate as
 * `/api/servers/[id]/token`. Without it the JWT keeps the legacy audience,
 * which gateways accept only alongside the shared token; once the browser
 * stops carrying that token (`PUBLIC_GATEWAY_BROWSER_SHARED_TOKEN=false`) the
 * id is required.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const authUser = requireAuth(locals);
    const ctx = await getTenantCtx(locals);
    if (!ctx) throw error(403, 'Active organization required');
    const gatewayId = url.searchParams.get('gatewayId');
    if (!gatewayId && browserSharedTokenOff()) {
      return json({ error: 'gateway_id_required' }, { status: 400, headers });
    }
    let audience: string | undefined;
    if (gatewayId) {
      const gatewayUrl = await getGatewayUrlForOrg(gatewayId, ctx.tenantId);
      const linked =
        gatewayUrl !== null &&
        (authUser.role === 'admin' ||
          (await userHasGatewayAccess(authUser.supabaseId ?? null, gatewayId)) ||
          // Legacy Turso link, kept for parity with the token route's bake-in.
          (await ctx.db
            .select({ serverId: userServers.serverId })
            .from(userServers)
            .where(and(eq(userServers.userId, authUser.id), eq(userServers.serverId, gatewayId)))
            .then((rows) => rows.length > 0)));
      if (!gatewayUrl || !linked) {
        return json(
          { error: 'gateway_forbidden', code: 'gateway_forbidden' },
          { status: 403, headers },
        );
      }
      audience = gatewayAudience(gatewayUrl);
    }
    return json(await issueGatewayJwt(ctx, authUser.id, { audience }), { headers });
  } catch (e) {
    if (isHttpError(e)) return json(e.body, { status: e.status, headers });
    if (e instanceof GatewayJwtAccessDenied) {
      return json({ error: 'Active organization membership required' }, { status: 403, headers });
    }
    Sentry.captureException(new Error('Gateway JWT issuance unavailable'), {
      tags: { operation: 'gateway.jwt.issue' },
    });
    // Registry or DB outage: transient, like the token route's 503.
    return json(
      { error: 'Failed to issue JWT' },
      { status: 503, headers: { ...headers, 'retry-after': '2' } },
    );
  }
};
