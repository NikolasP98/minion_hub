import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { getSettings } from '$server/services/settings.service';
import { requireTenantCtx } from '$server/auth/authorize';

export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = requireTenantCtx(locals);
  try {
    const settings = await getSettings(ctx, params.id!);
    return json({ settings });
  } catch {
    return json({ settings: {} });
  }
};
