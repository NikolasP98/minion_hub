import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { removeIdentity } from '$server/services/identity.service';
import { deleteOAuthIdentityFromSupabase } from '$server/services/supabase-credential';
import { requireAdmin } from '$server/auth/authorize';

export const DELETE: RequestHandler = async ({ locals, params, url }) => {
  if (!locals.tenantCtx) throw error(401);
  if (!params.id || !params.identityId) throw error(400);
  const isOwner = locals.user?.id === params.id;
  if (!isOwner) requireAdmin(locals);

  // OAuth identities are unlinked from the canonical Supabase vault; channel
  // identities still live in the Turso store.
  if (url.searchParams.get('source') === 'supabase') {
    const ok = await deleteOAuthIdentityFromSupabase(params.id, params.identityId);
    if (!ok) throw error(404, 'identity not found');
    return json({ ok: true });
  }

  // Scoped to the URL user (owner, or the admin-named user) so an id belonging
  // to anyone else is indistinguishable from an unknown one.
  if (!(await removeIdentity(locals.tenantCtx, params.id, params.identityId))) {
    throw error(404, 'identity not found');
  }
  return json({ ok: true });
};
