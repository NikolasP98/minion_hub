import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { gatewayCall } from '$lib/server/gateway-rpc';

export const POST: RequestHandler = async ({ locals, params, request }) => {
  requireAuth(locals);
  const pluginId = params.id ?? '';
  if (!pluginId) return json({ error: 'pluginId required' }, { status: 400 });
  // Per-org enable/disable: plugins are installed globally on the shared
  // gateway, but each org toggles them independently. Scope the write to the
  // acting user's org so it never affects other tenants.
  const orgId = locals.orgId ?? locals.tenantCtx?.tenantId;
  if (!orgId) return json({ error: 'no active organization' }, { status: 400 });
  let body: { enabled?: boolean } = {};
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid json body' }, { status: 400 });
  }
  if (typeof body.enabled !== 'boolean') {
    return json({ error: 'enabled boolean required' }, { status: 400 });
  }
  try {
    // `plugins.org.set` flips `plugins.orgDisabled[pluginId]` for this org only.
    // It never touches `entries.<id>.config`, so it bypasses each plugin's strict
    // config schema (the old global toggle wrote `config.enabled` and tripped
    // "must NOT have additional properties" on plugins like Discord). No restart.
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
