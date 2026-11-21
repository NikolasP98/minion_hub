import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { endConnection } from '$server/mcp/oauth.service';
import { hasOrgCapability } from '$server/services/rbac.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * DELETE /api/settings/mcp-connections/[id] — end a connection (spec 143 D13): the person's
 * own, or any of the active organization's with `settings:manage`. Its next call and its
 * renewal both get 401. An unknown, foreign or already-ended id is 404.
 */
export const DELETE: RequestHandler = async ({ locals, params }) => {
  const user = requireAuth(locals);
  const ctx = await requireCoreCtx(locals);
  const id = params.id ?? '';
  const me = user.supabaseId!;
  const ended =
    UUID_RE.test(id) &&
    ((await endConnection(id, me, { userId: me })) ||
      ((await hasOrgCapability(locals, 'settings', 'manage')) &&
        (await endConnection(id, me, { orgId: ctx.tenantId }))));
  return ended ? json({ ok: true }) : json({ error: 'not_found' }, { status: 404 });
};
