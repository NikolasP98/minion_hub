import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAdmin } from '$server/auth/authorize';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { listProducts, upsertProduct } from '$server/services/finance-products.service';

export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals); if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'finances'))) throw error(403);
  return json({ products: await listProducts(ctx) });
};

const putSchema = z.object({
  code: z.string().min(1).max(200),
  name: z.string().min(1).max(500),
  category: z.string().max(200).nullable().optional(),
  unitPrice: z.union([z.number(), z.string(), z.null()]).optional(),
  active: z.boolean().optional(),
});

export const PUT: RequestHandler = async ({ locals, request }) => {
  requireAdmin(locals);
  const ctx = await getCoreCtx(locals); if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'finances'))) throw error(403, 'finances module disabled');
  const b = await parseBody(request, putSchema);
  await upsertProduct(ctx, { code: b.code.trim(), name: b.name.trim(),
    category: b.category ? String(b.category) : null, unitPrice: b.unitPrice == null || b.unitPrice === '' ? null : Number(b.unitPrice),
    active: b.active !== false });
  return json({ ok: true });
};
