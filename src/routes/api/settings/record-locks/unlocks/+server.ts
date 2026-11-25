import type { RequestHandler } from '@sveltejs/kit';
import { error, json } from '@sveltejs/kit';
import { requireOrgCapability } from '$server/services/rbac.service';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { grantUnlock, personActor } from '$server/services/record-locks.service';
import { correctionResponse } from '../../../stock/_corrections-http';

/**
 * POST /api/settings/record-locks/unlocks `{ recordType, recordId, reason }` (spec 140 S3).
 * Owner only (the service checks the membership role after the central `settings:manage` gate).
 * 201 with a new unlock, 200 with the one already active. The unlock lasts 24 hours and covers one correction.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  await requireOrgCapability(locals, 'settings', 'manage');
  const ctx = await requireCoreCtx(locals);
  const body = await request.json().catch(() => null);
  if (body === null) throw error(400, 'invalid body');
  try {
    const { created, ...unlock } = await grantUnlock(
      ctx,
      body,
      personActor(ctx, locals.user?.displayName ?? locals.user?.email ?? null),
    );
    return json(unlock, { status: created ? 201 : 200, headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return correctionResponse(e);
  }
};
