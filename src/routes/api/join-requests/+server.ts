import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { env as publicEnv } from '$env/dynamic/public';
import { requireAuth } from '$server/auth/authorize';
import { requireOrgCapability } from '$server/services/rbac.service';
import { createRequest, listPendingRequests } from '$server/services/join/requests.service';
import { listAllOrganizations } from '$server/services/organizations.service';

/**
 * The applicant's join request has no org picker — resolve the one default
 * org it lands in. Prefers `PUBLIC_DEFAULT_ORG_SLUG` (single-tenant deploys
 * set this — see `.env.example`); a deploy that hasn't set it, or whose slug
 * matches no organization, falls back to the first org alphabetically (same
 * ordering `listAllOrganizations` already returns) and logs a warning so a
 * misconfigured slug doesn't silently misroute every request.
 */
async function resolveDefaultOrg() {
  const orgs = await listAllOrganizations();
  if (orgs.length === 0) return null;
  const slug = publicEnv.PUBLIC_DEFAULT_ORG_SLUG;
  if (!slug) {
    console.warn(
      '[join-requests] PUBLIC_DEFAULT_ORG_SLUG is not set — defaulting to the first organization alphabetically',
    );
    return orgs[0];
  }
  const bySlug = orgs.find((o) => o.slug === slug);
  if (!bySlug) {
    console.warn(
      `[join-requests] PUBLIC_DEFAULT_ORG_SLUG=${slug} matched no organization — defaulting to the first organization alphabetically`,
    );
    return orgs[0];
  }
  return bySlug;
}

export const POST: RequestHandler = async ({ locals, request }) => {
  const user = requireAuth(locals);
  if (!user.supabaseId) throw error(400, 'supabase session required');
  const body = (await request.json().catch(() => ({}))) as { message?: string };
  const defaultOrg = await resolveDefaultOrg();
  if (!defaultOrg) throw error(500, 'no organization configured');
  const r = await createRequest(
    { id: user.id, supabaseId: user.supabaseId, email: user.email, displayName: user.displayName },
    defaultOrg.id,
    body.message,
  );
  return json({ ok: true, id: r.id, status: r.status });
};

export const GET: RequestHandler = async ({ locals }) => {
  await requireOrgCapability(locals, 'users', 'manage');
  if (!locals.tenantCtx) throw error(401, 'tenant context required');
  return json({ requests: await listPendingRequests(locals.tenantCtx.tenantId) });
};
