import type { RequestHandler } from '@sveltejs/kit';
import { error, json } from '@sveltejs/kit';
import { requireOrgCapability } from '$server/services/rbac.service';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { liftLock, personActor } from '$server/services/record-locks.service';
import { correctionResponse } from '../../../../../stock/_corrections-http';

/**
 * POST /api/settings/record-locks/locks/[id]/lift `{ reason }` (spec 140 S4). Owner only (the
 * service checks the role after the central `settings:manage` gate). 200 `{ lifted }`;
 * `lifted: false` when the lock was already lifted.
 */
export const POST: RequestHandler = async ({ locals, request, params }) => {
  await requireOrgCapability(locals, 'settings', 'manage');
  const ctx = await requireCoreCtx(locals);
  const body = (await request.json().catch(() => null)) as { reason?: unknown } | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw error(400, 'invalid body');
  try {
    return json(
      await liftLock(
        ctx,
        params.id as string,
        body.reason,
        personActor(ctx, locals.user?.displayName ?? locals.user?.email ?? null),
      ),
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (e) {
    return correctionResponse(e);
  }
};
