import type { RequestHandler } from '@sveltejs/kit';
import { error, json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getCoreCtx } from '$server/auth/core-ctx';
import { checkRateLimit } from '$server/auth/rate-limit';
import { requireOrgCapability } from '$server/services/rbac.service';
import { uuidParamOr404 } from '$server/utils/uuid-param';
import { getDoor } from '$server/services/doors.service';
import { draftFaqsFromConversations } from '$server/services/doors-faq-draft.service';
import { requireFeature } from '$server/services/entitlements.service';

/**
 * POST /api/crm/doors/[id]/faq-draft → `{drafts:[{q,a,count}]}` (crm:manage).
 * Saves nothing: the editor appends the drafts and the owner decides.
 * 503 `ai_not_configured` without a model key; 429 after 3 calls / 10 min / org.
 */
export const POST: RequestHandler = async ({ locals, params }) => {
  await requireFeature(locals, 'ai');
  const id = uuidParamOr404(params.id!);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  await requireOrgCapability(locals, 'crm', 'manage');
  const door = await getDoor(ctx, id);
  if (!door || door.kind !== 'faq') throw error(404, 'Not found');
  if (!env.OPENROUTER_API_KEY) return json({ error: 'ai_not_configured' }, { status: 503 });
  if (!checkRateLimit(`faq-draft:${ctx.tenantId}`, 3, 600_000))
    return json({ error: 'rate_limited' }, { status: 429 });
  try {
    return json(await draftFaqsFromConversations(ctx));
  } catch (e) {
    // Error name only: provider errors can echo the prompt, which holds customer messages.
    console.error('[faq-draft] draft failed', e instanceof Error ? e.name : typeof e);
    return json({ error: 'draft_failed' }, { status: 502 });
  }
};
