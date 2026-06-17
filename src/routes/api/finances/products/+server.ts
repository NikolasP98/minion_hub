import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAdmin } from '$server/auth/authorize';
import { isModuleEnabled } from '$server/services/modules.service';
import { listProducts, upsertProduct } from '$server/services/finance-products.service';

export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals); if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'finances'))) throw error(403);
  return json({ products: await listProducts(ctx) });
};

export const PUT: RequestHandler = async ({ locals, request }) => {
  requireAdmin(locals);
  const ctx = await getCoreCtx(locals); if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'finances'))) throw error(403, 'finances module disabled');
  const b = await request.json().catch(() => ({})) as Record<string, unknown>;
  if (typeof b.code !== 'string' || !b.code.trim() || typeof b.name !== 'string' || !b.name.trim()) throw error(400, 'code and name required');
  await upsertProduct(ctx, { code: String(b.code).trim(), name: String(b.name).trim(),
    category: b.category ? String(b.category) : null, unitPrice: b.unitPrice == null || b.unitPrice === '' ? null : Number(b.unitPrice),
    active: b.active !== false });
  return json({ ok: true });
};
