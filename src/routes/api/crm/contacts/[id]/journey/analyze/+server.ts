import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { analyzeJourney } from '$server/services/crm-journey.service';
import { requireFeature } from '$server/services/entitlements.service';

/** POST /api/crm/contacts/[id]/journey/analyze — AI-infer journey milestones
 *  from conversation context, persist them, return the merged journey. */
export const POST: RequestHandler = async ({ locals, params }) => {
  await requireFeature(locals, 'ai');
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const milestones = await analyzeJourney(ctx, params.id!);
  return json({ milestones });
};
