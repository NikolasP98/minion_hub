import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { getSettingsSection, upsertSettings } from '$server/services/settings.service';
import { requireAdmin } from '$server/auth/authorize';
import { getServerCtx } from '$server/auth/core-ctx';

export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await getServerCtx(locals, params.id!);
  if (!ctx) return json({ value: null });
  try {
    const value = await getSettingsSection(ctx, params.section!);
    return json({ value });
  } catch {
    return json({ value: null });
  }
};

export const PUT: RequestHandler = async ({ locals, params, request }) => {
  requireAdmin(locals);
  const ctx = await getServerCtx(locals, params.id!);
  if (!ctx) return json({ ok: false, error: 'no gateway access' }, { status: 403 });
  try {
    const body: unknown = await request.json();
    await upsertSettings(ctx, params.section!, body);
    return json({ ok: true });
  } catch (e) {
    console.error(`[PUT /api/servers/${params.id}/settings/${params.section}]`, e);
    return json(
      { ok: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
};
