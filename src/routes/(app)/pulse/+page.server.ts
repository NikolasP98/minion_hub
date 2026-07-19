import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import { getTenant } from '$server/services/tenant.service';
import { listPending } from '$server/services/pulse.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  requireAuth(locals);
  const ctx = await requireCoreCtx(locals);
  await requireOrgCapability(locals, 'pulse', 'view');
  // Pulse is personal-org-only (org-kind-segregation spec). A business org
  // shouldn't even learn the route exists, so 404 rather than 403 — the kind
  // is read from the server-resolved tenant id (ctx.tenantId), never a
  // client-supplied value. getTenant only reads `.tenantId` off its arg.
  const tenant = await getTenant({ tenantId: ctx.tenantId } as Parameters<typeof getTenant>[0]);
  if (tenant?.kind === 'business') throw error(404, 'Not found');
  depends('pulse:feed');
  return { proposals: await listPending(ctx) };
};
