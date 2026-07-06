import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { listAccruals, committedSpend } from '$server/services/stock-accruals.service';

export const load: PageServerLoad = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'stock'))) throw error(404, 'Stock module disabled');
  const [open, realized, committed] = await Promise.all([
    listAccruals(ctx, { status: 'open' }),
    listAccruals(ctx, { status: 'realized' }),
    committedSpend(ctx),
  ]);
  return { open, realized, committed };
};
