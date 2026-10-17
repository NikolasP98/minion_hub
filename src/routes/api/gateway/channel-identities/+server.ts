import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { listChannelIdentities } from '$server/services/channel-identity.service';
import { getTenantCtx } from '$server/auth/tenant-ctx';

/**
 * GET /api/gateway/channel-identities
 *
 * Returns all channel identity mappings for gateway startup fetch.
 * Protected by server token auth (Bearer token from gateway) or admin session —
 * enforced below. Previously the only gate was `getTenantCtx`, which ANY
 * logged-in member of ANY org resolves, so every user's channel mappings
 * (phone numbers) were readable platform-wide
 * (audits/2026-10-15-agent-harness/E-rbac-parity.md S2).
 *
 * Note: this path is NOT in resolve-identity's `isServerTokenPath` allowlist, so
 * `locals.serverId` is never set here today — a Bearer-only gateway call already
 * 401s on the missing tenant ctx. The admin branch is the live one (the hub's
 * own caller, the plugin-bridge `plugins.users.list` RPC, is platform-admin-only
 * anyway because it also reads `/api/users`). Restoring the gateway's startup
 * fetch means adding the allowlist entry, not loosening the gate.
 */
export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getTenantCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!locals.serverId && locals.user?.role !== 'admin') throw error(403, 'forbidden');

  try {
    // TODO(handoff): the result is still platform-wide, not org-scoped —
    // `user_identities` has no org column (src/server/db/schema/user-identities.ts)
    // and no cheap join to `organization_members` exists on this Turso read, so
    // scoping needs a schema/ownership decision. See minion-meta
    // proposals/2026-10-15-agent-harness-restoration.md.
    const identities = await listChannelIdentities(ctx);
    return json({ identities });
  } catch (e) {
    console.error('[GET /api/gateway/channel-identities]', e);
    return json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
};
