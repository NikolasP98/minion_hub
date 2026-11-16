import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import { ApiKeyError, revokeKey } from '$server/services/org-api-keys.service';

/** DELETE /api/settings/api-keys/[id] — revoke; a repeat is ok, an unknown id is 404. */
export const DELETE: RequestHandler = async ({ locals, params }) => {
  await requireOrgCapability(locals, 'settings', 'manage');
  try {
    await revokeKey(await requireCoreCtx(locals), params.id ?? '');
  } catch (e) {
    if (e instanceof ApiKeyError) return json({ error: e.code }, { status: 404 });
    throw e;
  }
  return json({ ok: true });
};
