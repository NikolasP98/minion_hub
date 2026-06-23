import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { listOrders, type OrderStatus } from '$server/services/sales.service';

/** GET /api/sales/orders?status=&contact= */
export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'sales'))) throw error(404);
  return json(
    await listOrders(ctx, {
      status: (url.searchParams.get('status') as OrderStatus | 'open') ?? undefined,
      crmContactId: url.searchParams.get('contact') ?? undefined,
    }),
  );
};
