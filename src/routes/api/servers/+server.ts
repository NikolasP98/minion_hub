import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { listServers, upsertServer } from '$server/services/server.service';
import { getTenantCtx, getOrCreateTenantCtx } from '$server/auth/tenant-ctx';
import { getPostHogClient } from '$lib/server/posthog';
import { assertSafeUrl, SsrfBlockedError } from '$server/services/ssrf-guard';

export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getTenantCtx(locals);
  if (!ctx) return json({ servers: [] });
  try {
    const servers = await listServers(ctx, locals.user?.id, locals.user?.role);
    return json({ servers });
  } catch (e) {
    console.error('[GET /api/servers]', e);
    return json({ servers: [] });
  }
};

export const POST: RequestHandler = async ({ locals, request }) => {
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
    await upsertServer(ctx, body, locals.user?.id);
    const posthog = await getPostHogClient();
    posthog?.capture({
      distinctId: locals.user?.id ?? 'anonymous',
      event: 'server_added',
      properties: {
        server_name: body.name,
        server_url: body.url,
      },
    });
    return json({ ok: true });
  } catch (e) {
    console.error('[POST /api/servers]', e);
    return json(
      { ok: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
};
