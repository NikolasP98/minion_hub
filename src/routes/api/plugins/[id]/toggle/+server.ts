import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { gatewayCall } from '$lib/server/gateway-rpc';

export const POST: RequestHandler = async ({ locals, params, request }) => {
  requireAuth(locals);
  const pluginId = params.id ?? '';
  if (!pluginId) return json({ error: 'pluginId required' }, { status: 400 });
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
    const cur = await gatewayCall<{ config?: Record<string, unknown> }>('plugins.config.get', {
      pluginId,
    });
    // Soft master switch convention: write `config.enabled` instead of toggling
    // load-level enable. Keeps the plugin loaded; runtime honors `config.enabled`
    // as its master flag. Uniform across plugins so the hub header toggle has
    // the same meaning everywhere.
    const config = { ...((cur?.config ?? {}) as Record<string, unknown>), enabled: body.enabled };
    const result = await gatewayCall<{
      ok: boolean;
      restartRequired: boolean;
      errors?: string[];
    }>('plugins.config.set', { pluginId, config });
    return json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: message }, { status: 502 });
  }
};
