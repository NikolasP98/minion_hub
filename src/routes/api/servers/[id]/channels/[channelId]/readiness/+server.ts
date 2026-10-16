import { error, json, type RequestHandler } from '@sveltejs/kit';
import { getServerCtx } from '$server/auth/core-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import { getWhatsAppAccountReadiness } from '$server/services/whatsapp-readiness.service';

/** Administrative account readiness includes member blockers, never phone numbers or credentials. */
export const GET: RequestHandler = async ({ locals, params, url }) => {
  const ctx = await getServerCtx(locals, params.id!);
  if (!ctx) throw error(401, 'Authentication required');
  await requireOrgCapability(locals, 'channels', 'edit');
  return json(
    await getWhatsAppAccountReadiness(
      {
        orgId: ctx.tenantId,
        gatewayId: ctx.gatewayId,
        channelId: params.channelId!,
      },
      {
        limit: url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : undefined,
        cursor: url.searchParams.get('cursor') ?? undefined,
      },
    ),
  );
};
