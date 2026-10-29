import type { RequestHandler } from '@sveltejs/kit';
import { json, error, isHttpError } from '@sveltejs/kit';
import * as Sentry from '@sentry/sveltekit';
import { GatewayJwtAccessDenied, issueGatewayJwt } from '$server/services/gateway-jwt.service';
import { requireAuth } from '$server/auth/authorize';
import { getTenantCtx } from '$server/auth/tenant-ctx';
import { isEnforced, resolveEntitlements } from '$server/services/entitlements.service';

/** Spec 043: plan claims only when enforced; a lookup error issues without them (R5). */
async function entitlementClaims(orgId: string) {
  if (!isEnforced()) return undefined;
  const r = await resolveEntitlements(orgId);
  if (r.lookupError) {
    console.warn('entitlement.lookup_error', JSON.stringify({ orgId, surface: 'gateway.jwt' }));
    return undefined;
  }
  return { plan: r.plan, features: r.features };
}

/** Cookie-authenticated issuance; every outcome is private and non-cacheable. */
export const GET: RequestHandler = async ({ locals }) => {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const authUser = requireAuth(locals);
    const ctx = await getTenantCtx(locals);
    if (!ctx) throw error(403, 'Active organization required');
    const claims = await entitlementClaims(ctx.tenantId);
    return json(await issueGatewayJwt(ctx, authUser.id, claims), { headers });
  } catch (e) {
    if (isHttpError(e)) return json(e.body, { status: e.status, headers });
    if (e instanceof GatewayJwtAccessDenied) {
      return json({ error: 'Active organization membership required' }, { status: 403, headers });
    }
    Sentry.captureException(new Error('Gateway JWT issuance unavailable'), {
      tags: { operation: 'gateway.jwt.issue' },
    });
    return json({ error: 'Failed to issue JWT' }, { status: 500, headers });
  }
};
