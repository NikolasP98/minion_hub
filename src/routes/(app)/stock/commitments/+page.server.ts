import type { PageServerLoad } from './$types';
import { datasetCtx, isDenied } from '$server/auth/dataset-ctx';
import { listAccruals, committedSpend } from '$server/services/stock-accruals.service';

export const load: PageServerLoad = async ({ locals }) => {
  const ctx = await datasetCtx(locals, 'stock');
  if (isDenied(ctx)) return { stock: ctx }; // rendered by DataSource (spec 039)
  const [open, realized, committed] = await Promise.all([
    listAccruals(ctx, { status: 'open' }),
    listAccruals(ctx, { status: 'realized' }),
    committedSpend(ctx),
  ]);
  return { stock: { open, realized, committed } };
};
