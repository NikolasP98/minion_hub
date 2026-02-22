import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getSettingsSection, upsertSettings } from '$server/services/settings.service';

export const GET: RequestHandler = async ({ locals, params }) => {
  if (!locals.tenantCtx) throw error(401);
  try {
    const value = await getSettingsSection(locals.tenantCtx, params.id!, params.section!);
    return json({ value });
  } catch {
    return json({ value: null });
  }
};

export const PUT: RequestHandler = async ({ locals, params, request }) => {
  if (!locals.tenantCtx) throw error(401);
  try {
    const body: unknown = await request.json();
    await upsertSettings(locals.tenantCtx, params.id!, params.section!, body);
    return json({ ok: true });
  } catch (e) {
    console.error(`[PUT /api/servers/${params.id}/settings/${params.section}]`, e);
    return json({ ok: false, error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
};
