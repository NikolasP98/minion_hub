import { error, json, type RequestHandler } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { getWhatsAppMemberReadiness } from '$server/services/whatsapp-readiness.service';

/** Own-personal-agent inspection only; an agent's normal provisioning state is independent. */
export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!locals.user || !ctx?.profileId) throw error(401, 'Authentication required');
  const channelId = url.searchParams.get('channelId') ?? undefined;
  return json(
    await getWhatsAppMemberReadiness({ orgId: ctx.tenantId, profileId: ctx.profileId, channelId }),
  );
};
