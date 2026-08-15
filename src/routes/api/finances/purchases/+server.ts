import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { listPurchases, createPurchase } from '$server/services/purchases.service';
import { handlePurchasesError } from './_errors';

const createSchema = z.object({
  period: z.string().regex(/^\d{6}$/, 'period must be YYYYMM'),
  supplierRuc: z.string().max(20).nullable().optional(),
  supplierName: z.string().max(300).nullable().optional(),
  docType: z.string().max(10).nullable().optional(),
  serie: z.string().max(20).nullable().optional(),
  numero: z.string().max(20).nullable().optional(),
  issuedAt: z.string().max(10).nullable().optional(),
  currency: z.string().max(10).nullable().optional(),
  baseGravada: z.number().finite().nullable().optional(),
  igv: z.number().finite().nullable().optional(),
  total: z.number().finite().nullable().optional(),
});

/** GET /api/finances/purchases?period=YYYYMM */
export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'finances'))) throw error(404);
  const period = url.searchParams.get('period') ?? undefined;
  return json(await listPurchases(ctx, { period }));
};

/** POST /api/finances/purchases — manual entry, open period only. */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'finances'))) throw error(404);
  const body = await parseBody(request, createSchema);
  try {
    const row = await createPurchase(ctx, body);
    return json(row, { status: 201 });
  } catch (e) {
    return handlePurchasesError(e);
  }
};
