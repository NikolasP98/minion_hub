import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getSettings } from '$server/services/settings.service';

export const GET: RequestHandler = async ({ locals, params }) => {
  if (!locals.tenantCtx) throw error(401);
  try {
    const settings = await getSettings(locals.tenantCtx, params.id!);
    return json({ settings });
  } catch {
    return json({ settings: {} });
  }
};
