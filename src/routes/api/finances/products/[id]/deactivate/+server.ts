import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAdmin } from '$server/auth/authorize';
import { deactivateProduct } from '$server/services/finance-products.service';

export const POST: RequestHandler = async ({ locals, params }) => {
  requireAdmin(locals);
  const ctx = await getCoreCtx(locals); if (!ctx) throw error(401);
  await deactivateProduct(ctx, params.id!);
  return json({ ok: true });
};
