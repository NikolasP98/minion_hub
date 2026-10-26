import type { RequestHandler } from '@sveltejs/kit';
import { error, json } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireOrgCapability, shouldMaskSensitive } from '$server/services/rbac.service';
import { uuidParamOr404 } from '$server/utils/uuid-param';
import { getDoor } from '$server/services/doors.service';
import { listSubmissions } from '$server/services/doors-form.service';

/**
 * GET /api/crm/doors/[id]/submissions?cursor&limit≤50 — a form door's
 * submissions, newest first. Submissions can hold clinical free text, so
 * reading them needs `crm:manage` (org owner/admin; owner decision, spec 041),
 * not `crm:view`. Values are still masked for a principal below the sensitive
 * field level.
 */
export const GET: RequestHandler = async ({ locals, params, url }) => {
  const id = uuidParamOr404(params.id!);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  await requireOrgCapability(locals, 'crm', 'manage');
  const door = await getDoor(ctx, id);
  if (!door || door.kind !== 'form') throw error(404, 'Not found');
  const page = await listSubmissions(ctx, door, {
    cursor: url.searchParams.get('cursor'),
    limit: Number(url.searchParams.get('limit') ?? 20),
    mask: await shouldMaskSensitive(locals, 'crm'),
  });
  return json(page, { headers: { 'cache-control': 'no-store' } });
};
