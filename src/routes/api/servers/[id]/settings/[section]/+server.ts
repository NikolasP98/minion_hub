import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { getSettingsSection, upsertSettings } from '$server/services/settings.service';
import { requireAdmin, requireTenantCtx } from '$server/auth/authorize';

export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = requireTenantCtx(locals);
  try {
    const value = await getSettingsSection(ctx, params.id!, params.section!);
    return json({ value });
  } catch {
    return json({ value: null });
  }
};

export const PUT: RequestHandler = async ({ locals, params, request }) => {
  requireAdmin(locals);
  const ctx = requireTenantCtx(locals);
  try {
    const body: unknown = await request.json();
    await upsertSettings(ctx, params.id!, params.section!, body);
    return json({ ok: true });
  } catch (e) {
    console.error(`[PUT /api/servers/${params.id}/settings/${params.section}]`, e);
    return json(
      { ok: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
};
