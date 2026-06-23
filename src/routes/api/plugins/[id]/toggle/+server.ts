import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { getCoreCtx } from '$server/auth/core-ctx';
import {
  listGatewayHostsForUser,
  resolveGatewayId,
} from '$server/services/gateway.pg.service';
import { setPluginDisabledForOrg } from '$server/services/org-config-sync.service';
import { gatewayCall } from '$lib/server/gateway-rpc';

export const POST: RequestHandler = async ({ locals, params, request }) => {
  requireAuth(locals);
  const pluginId = params.id ?? '';
  if (!pluginId) return json({ error: 'pluginId required' }, { status: 400 });
  // Per-org enable/disable: plugins are installed globally on the shared
  // gateway, but each org toggles them independently. Scope the write to the
  // acting user's org so it never affects other tenants.
  const ctx = await getCoreCtx(locals);
  const orgId = ctx?.tenantId ?? locals.orgId ?? locals.tenantCtx?.tenantId;
  if (!ctx || !orgId) return json({ error: 'no active organization' }, { status: 400 });
  let body: { enabled?: boolean } = {};
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid json body' }, { status: 400 });
  }
  if (typeof body.enabled !== 'boolean') {
    return json({ error: 'enabled boolean required' }, { status: 400 });
  }

  // Resolve the acting gateway. Single-gateway deploy: the user's (only) gateway.
  // ponytail: for multi-gateway, have the client pass the active serverId and use
  // getServerCtx(locals, serverId) instead of "first host".
  const hosts = await listGatewayHostsForUser(ctx.profileId ?? null, locals.user?.role === 'admin');
  const gatewayId = hosts[0] ? await resolveGatewayId(hosts[0].id) : null;
  if (!gatewayId) return json({ ok: false, error: 'no gateway available' }, { status: 502 });

  try {
    // DB is the source of truth (org-scope → DB). Write first, RLS-scoped to this
    // org. `disabled` is the inverse of `enabled`.
    await setPluginDisabledForOrg(ctx, gatewayId, pluginId, !body.enabled);

    // Keep the live gateway in sync via `plugins.org.set` — it read-modify-writes
    // `plugins.orgDisabled[pluginId]` authoritatively (handles the re-enable
    // delete) and never restarts the shared gateway. On a fresh-disk redeploy the
    // gateway recovers this state from the DB via reconcileOrgConfig.
    const result = await gatewayCall<{
      ok: boolean;
      restartRequired: boolean;
      errors?: string[];
    }>('plugins.org.set', { pluginId, orgId, enabled: body.enabled });
    return json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: message }, { status: 502 });
  }
};
