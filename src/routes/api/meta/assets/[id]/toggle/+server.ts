import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import { toggleAsset } from '$server/services/meta/meta-connections.service';

/** POST /api/meta/assets/[id]/toggle — body `{ enabled: boolean }`. */
export const POST: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  await requireOrgCapability(locals, 'ads', 'manage');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'invalid JSON body');
  }
  const enabled = (body as { enabled?: unknown })?.enabled;
  if (typeof enabled !== 'boolean') throw error(400, 'enabled (boolean) required');

  const found = await toggleAsset(ctx, params.id!, enabled);
  if (!found) throw error(404, 'asset not found');
  return json({ ok: true, id: params.id, enabled });
};
