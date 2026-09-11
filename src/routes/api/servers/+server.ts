import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { upsertServer } from '$server/services/server.service';
import { loadHostsForUser } from '$server/services/hosts.service';
import { getOrCreateTenantCtx } from '$server/auth/tenant-ctx';
import { requireAuth } from '$server/auth/authorize';
import { captureServerEvent } from '$lib/server/posthog';
import { requestIdentity, distinctIdFor, correlationId } from '$lib/server/observability-context';
import { assertSafeUrl, SsrfBlockedError } from '$server/services/ssrf-guard';

export const GET: RequestHandler = async ({ locals }) => {
  try {
    return json(await loadHostsForUser(locals, locals.user?.id, locals.user?.role));
  } catch (e) {
    console.error('[GET /api/servers]', e);
    // Non-authoritative failure (decrypt error, schema drift, etc.).
    // Return 500 so the client preserves its cached hosts.
    return json(
      { ok: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
};

export const POST: RequestHandler = async ({ locals, request, route }) => {
  // Per-user host ownership: only authenticated users can add hosts so
  // every new server gets a `user_servers` link. Anonymous adds would
  // leave the row orphaned (visible only to admins, invisible to the
  // person who added it on next session).
  const user = requireAuth(locals);
  const ctx = await getOrCreateTenantCtx(locals);
  try {
    const body = await request.json();
    try {
      await assertSafeUrl(body.url, 'server URL');
    } catch (err) {
      if (err instanceof SsrfBlockedError) {
        return json({ ok: false, error: err.message }, { status: 422 });
      }
      throw err;
    }
    const serverId = await upsertServer(ctx, body, user.id);
    try {
      const identity = requestIdentity({
        routeId: route.id,
        method: request.method,
        headers: request.headers,
        locals,
      });
      captureServerEvent({
        distinctId: distinctIdFor(identity),
        event: 'server_added',
        properties: { ...identity, server_id: correlationId('server', serverId) },
      });
    } catch {
      // Telemetry metadata must not change the application outcome.
    }
    return json({ ok: true });
  } catch (e) {
    console.error('[POST /api/servers] request failed');
    return json(
      { ok: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
};
