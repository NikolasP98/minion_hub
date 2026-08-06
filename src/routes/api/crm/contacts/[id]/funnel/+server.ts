import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { setFunnelStage } from '$server/services/crm-contacts.service';
import { isFunnelStage } from '$lib/components/crm/crm-funnel';
import { getTenant } from '$server/services/tenant.service';

const patchSchema = z.object({ stage: z.unknown() });

/**
 * PATCH /api/crm/contacts/[id]/funnel { stage }
 *   → manual override; pins the marketing-funnel stage (auto=false). May move
 *     the contact up OR down the funnel. Logs a crm_activities funnel row.
 */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  // The marketing funnel is a business-CRM concept — personal orgs shouldn't
  // even learn the route exists (404, not 403). Same getTenant-by-tenantId
  // pattern as the /pulse kind guard.
  const tenant = await getTenant({ tenantId: ctx.tenantId } as Parameters<typeof getTenant>[0]);
  if (tenant?.kind === 'personal') throw error(404, 'Not found');
  const { stage } = await parseBody(request, patchSchema);
  if (!isFunnelStage(stage)) throw error(400, 'invalid stage');
  const result = await setFunnelStage(ctx, params.id!, stage, { by: 'user' });
  return json(result);
};
