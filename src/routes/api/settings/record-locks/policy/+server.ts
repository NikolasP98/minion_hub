import type { RequestHandler } from '@sveltejs/kit';
import { error, json } from '@sveltejs/kit';
import { requireOrgCapability } from '$server/services/rbac.service';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { personActor, setLockPolicy } from '$server/services/record-locks.service';
import { correctionResponse } from '../../../stock/_corrections-http';

/**
 * PUT /api/settings/record-locks/policy `{ month, days, webhook }` (spec 140 S2).
 * The central write gate (`API_WRITE_PREFIXES`) and `settings:manage` let admins reach this;
 * the service then answers 403 `owner_required` for everyone but an owner.
 */
export const PUT: RequestHandler = async ({ locals, request }) => {
  await requireOrgCapability(locals, 'settings', 'manage');
  const ctx = await requireCoreCtx(locals);
  const body = await request.json().catch(() => null);
  if (body === null) throw error(400, 'invalid body');
  try {
    const policy = await setLockPolicy(
      ctx,
      body,
      personActor(ctx, locals.user?.displayName ?? locals.user?.email ?? null),
    );
    return json({ policy }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return correctionResponse(e);
  }
};
