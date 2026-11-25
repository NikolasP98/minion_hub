import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import { CorrectionError } from '$server/services/stock-corrections.logic';
import { ApiKeyError, createKey, listKeys } from '$server/services/org-api-keys.service';

// Organization API keys (spec 121). A 403 comes from `requireOrgCapability` / the central
// write guard. The key text leaves the server only in the POST answer.
const STATUS = {
  invalid_name: 400,
  invalid_scope: 400,
  limit_reached: 409,
  not_found: 404,
} as const;

/** GET /api/settings/api-keys — every key of the active organization (never a hash). */
export const GET: RequestHandler = async ({ locals }) => {
  await requireOrgCapability(locals, 'settings', 'manage');
  return json({ keys: await listKeys(await requireCoreCtx(locals)) });
};

/** POST /api/settings/api-keys `{ name, scopes? }` → 201 with the key text, shown once. */
export const POST: RequestHandler = async ({ locals, request }) => {
  await requireOrgCapability(locals, 'settings', 'manage');
  const ctx = await requireCoreCtx(locals);
  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    scopes?: unknown;
  } | null;
  const name = typeof body?.name === 'string' ? body.name : '';
  try {
    return json(await createKey(ctx, name, Array.isArray(body?.scopes) ? body.scopes : []), {
      status: 201,
    });
  } catch (e) {
    if (e instanceof ApiKeyError) return json({ error: e.code }, { status: STATUS[e.code] });
    // The `locks` scope is owner-only: 403 says the role cannot, never a generic failure.
    if (e instanceof CorrectionError && (e.code === 'owner_required' || e.code === 'forbidden'))
      return json({ error: 'owner_required' }, { status: 403 });
    throw e;
  }
};
