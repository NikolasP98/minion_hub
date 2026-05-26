import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { createGateway, listGatewaysForAdmin } from '$server/services/gateway.pg.service';
import { assertSafeUrl, SsrfBlockedError } from '$server/services/ssrf-guard';

export const GET: RequestHandler = async ({ locals }) => {
  requireAdmin(locals);
  return json({ gateways: await listGatewaysForAdmin() });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  const admin = requireAdmin(locals);
  if (!admin.supabaseId) throw error(400, 'supabase session required');
  const b = (await request.json().catch(() => ({}))) as { name?: string; url?: string; token?: string };
  if (!b.name || !b.url || !b.token) throw error(400, 'name, url, and token required');
  try {
    await assertSafeUrl(b.url, 'gateway URL');
  } catch (e) {
    if (e instanceof SsrfBlockedError) return json({ ok: false, error: e.message }, { status: 422 });
    throw e;
  }
  const g = await createGateway({ name: b.name, url: b.url, token: b.token, profileId: admin.supabaseId });
  return json({ ok: true, id: g.id });
};
