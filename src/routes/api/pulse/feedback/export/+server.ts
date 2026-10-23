import type { RequestHandler } from './$types';
import { requireAuth } from '$server/auth/authorize';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import { exportPulseFeedback } from '$server/services/pulse-feedback.service';
export const GET: RequestHandler = async ({ locals, url }) => {
  requireAuth(locals);
  await requireOrgCapability(locals, 'pulse', 'export');
  return new Response(await exportPulseFeedback(await requireCoreCtx(locals), url.searchParams), {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'content-disposition': 'attachment; filename="pulse-feedback.jsonl"',
      'cache-control': 'private, no-store',
    },
  });
};
