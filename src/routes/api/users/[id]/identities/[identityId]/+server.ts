import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getPgClient } from '$server/db/pg-pool';
import { and, eq } from 'drizzle-orm';
import { userIdentities } from '$server/db/schema/user-identities';
import { requireAdmin } from '$server/auth/authorize';

export const DELETE: RequestHandler = async ({ locals, params, url }) => {
  if (!locals.tenantCtx) throw error(401);
  if (!params.id || !params.identityId) throw error(400);
  const isOwner = locals.user?.id === params.id;
  if (!isOwner) requireAdmin(locals);

  // The canonical vault owns channel claims as well as OAuth identities. The row
  // owner is checked in SQL; a caller-controlled source hint cannot bypass it.
  const profileId = isOwner ? (locals.user?.supabaseId ?? params.id) : params.id;
  const removed = await getPgClient().begin(async (tx) => {
    await tx`select id from whatsapp_assistant_turns where identity_id::text=${params.identityId!} and profile_id::text=${profileId} order by id for update`;
    const rows = await tx`delete from user_identities where id::text=${params.identityId!}
      and user_id::text=${profileId} returning id`;
    if (!rows.length) return false;
    await tx`update whatsapp_assistant_turns set state='cancelled',updated_at=now()
      where identity_id=${rows[0].id} and state in ('admitted','running')`;
    await tx`update whatsapp_assistant_replies set state='cancelled',updated_at=now()
      where state='pending' and turn_id in (select id from whatsapp_assistant_turns where identity_id=${rows[0].id})`;
    return true;
  });
  if (removed) return json({ ok: true });
  if (url.searchParams.get('source') === 'supabase') throw error(404, 'identity not found');
  const legacy = await locals.tenantCtx.db
    .delete(userIdentities)
    .where(and(eq(userIdentities.id, params.identityId), eq(userIdentities.userId, params.id)))
    .returning({ id: userIdentities.id });
  if (!legacy.length) throw error(404, 'identity not found');
  return json({ ok: true });
};
