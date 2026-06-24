import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAdmin } from '$server/auth/authorize';
import {
  getDefaultLayout,
  setDefaultLayout,
  type DashboardLayout,
} from '$server/services/dashboard-layouts.service';

/** GET — the org's pinned default layout for a dashboard (any authed user). */
export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const layout = await getDefaultLayout(ctx, params.id!);
  return json({ layout });
};

/** Narrow unknown JSON to a DashboardLayout, or null if malformed. */
function parseLayout(body: unknown): DashboardLayout | null {
  if (!body || typeof body !== 'object') return null;
  const o = (body as Record<string, unknown>).order;
  const s = (body as Record<string, unknown>).span;
  if (!Array.isArray(o) || !o.every((x) => typeof x === 'string')) return null;
  if (!s || typeof s !== 'object') return null;
  return { order: o as string[], span: s as DashboardLayout['span'] };
}

/** PUT — pin the org default layout (admins only). */
export const PUT: RequestHandler = async ({ locals, params, request }) => {
  requireAdmin(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const layout = parseLayout(await request.json().catch(() => null));
  if (!layout) return json({ ok: false, error: 'invalid layout' }, { status: 400 });
  await setDefaultLayout(ctx, params.id!, layout);
  return json({ ok: true });
};
