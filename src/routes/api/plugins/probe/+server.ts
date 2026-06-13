import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { getGatewayHttpUrlForUser } from '$lib/server/gateway-rpc';

/**
 * Server-side probe for a plugin's UI assets. Used by PluginIframe's handshake
 * timeout diagnostic: a cross-origin client `fetch` to the gateway can't read
 * the response status (CORS), so the single most common real failure —
 * the gateway returning 404 because the plugin isn't deployed/enabled on that
 * box — was being misreported as a bridge/Referrer/WebSocket problem. Probing
 * from the hub server has no CORS restriction, so we get the true HTTP status
 * and any CSP `frame-ancestors` directive.
 *
 * SSRF-safe: the gateway origin is resolved server-side from the user's own
 * gateway credentials (never user-supplied), and the path is constrained to
 * `/plugins/<pluginId>/ui/<subpath>` with traversal stripped.
 */
const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9-]*$/i;

function sanitizeSubpath(raw: string): string {
  return raw
    .replace(/^ui\/dist\//, '')
    .replace(/^\/+/, '')
    .split('/')
    .filter((seg) => seg && seg !== '.' && seg !== '..')
    .join('/');
}

export const GET: RequestHandler = async ({ locals, url }) => {
  // Auth-gate (throws 401 if unauthenticated); the gateway origin below is
  // resolved from the caller's own credentials, never from the request.
  await requireCoreCtx(locals);
  const profileId = locals.user?.supabaseId;

  const pluginId = (url.searchParams.get('pluginId') ?? '').trim();
  const subpath = sanitizeSubpath(url.searchParams.get('subpath') ?? '');
  if (!PLUGIN_ID_RE.test(pluginId) || !subpath) {
    return json({ ok: false, error: 'invalid pluginId or subpath' }, { status: 400 });
  }

  let base: string;
  try {
    base = await getGatewayHttpUrlForUser(profileId);
  } catch {
    return json({ ok: false, error: 'no gateway configured' }, { status: 502 });
  }

  const target = `${base}/plugins/${pluginId}/ui/${subpath}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(target, { method: 'GET', signal: controller.signal });
    clearTimeout(timer);
    return json({
      ok: res.ok,
      status: res.status,
      csp: res.headers.get('content-security-policy'),
    });
  } catch (err) {
    return json({ ok: false, error: String((err as Error)?.message ?? err) }, { status: 502 });
  }
};
