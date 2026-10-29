import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { similarWins } from '$server/services/crm-similarity.service';
import { requireFeature } from '$server/services/entitlements.service';

/** GET /api/crm/contacts/[id]/similar-wins → top similar winning conversations. */
export const GET: RequestHandler = async ({ locals, params }) => {
  await requireFeature(locals, 'ai');
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  const wins = await similarWins(ctx, params.id!, 3);
  return json({ wins });
};
