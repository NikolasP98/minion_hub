import { parseGridLayout } from '$lib/components/dashboard/editable-grid';
import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAdmin } from '$server/auth/authorize';
import { getDefaultLayout, setDefaultLayout } from '$server/services/dashboard-layouts.service';

/** GET — the org's pinned default layout for a dashboard (any authed user). */
export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const layout = await getDefaultLayout(ctx, params.id!);
  return json({ layout });
};

/** PUT — pin the org default layout (admins only). */
export const PUT: RequestHandler = async ({ locals, params, request }) => {
  requireAdmin(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const layout = parseGridLayout(await request.json().catch(() => null));
  if (!layout) return json({ ok: false, error: 'invalid layout' }, { status: 400 });
  await setDefaultLayout(ctx, params.id!, layout);
  return json({ ok: true });
};
