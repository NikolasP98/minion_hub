import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { getSettings } from '$server/services/settings.service';
import { getServerCtx } from '$server/auth/core-ctx';

export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await getServerCtx(locals, params.id!);
  if (!ctx) return json({ settings: {} });
  try {
    const settings = await getSettings(ctx);
    return json({ settings });
  } catch {
    return json({ settings: {} });
  }
};
