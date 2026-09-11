import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { upsertServer } from '$server/services/server.service';
import { loadHostsForUser } from '$server/services/hosts.service';
import { getOrCreateTenantCtx } from '$server/auth/tenant-ctx';
import { requireAuth } from '$server/auth/authorize';
import { getPostHogClient } from '$lib/server/posthog';
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

export const POST: RequestHandler = async ({ locals, request }) => {
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
        return json({ ok: false, error: 'Server URL is not allowed.' }, { status: 422 });
      }
      throw err;
    }
    await upsertServer(ctx, body, user.id);
    const posthog = await getPostHogClient();
    posthog?.capture({
      distinctId: user.id,
      event: 'server_added',
    });
    return json({ ok: true });
  } catch {
    // Database/URL error messages can contain request values or bound tokens.
    // Keep diagnostics independent of the request and the exception payload.
    console.error('[POST /api/servers] Unable to save server.');
    return json({ ok: false, error: 'Unable to save server.' }, { status: 500 });
  }
};
