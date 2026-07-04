import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import { parseBody } from '$server/api/validate';
import { getTemplate, updateTemplate, fanOutTemplate } from '$server/services/brain-agents.service';

/** GET /api/brains/template — the org's Brain Agent Template. Gated
 *  `brains:manage` (stricter than the generic `brains:edit` write gate). */
export const GET: RequestHandler = async ({ locals }) => {
  await requireOrgCapability(locals, 'brains', 'manage');
  const ctx = await requireCoreCtx(locals);
  return json({ template: await getTemplate(ctx) });
};

const putSchema = z.object({
  namePrefix: z.string().trim().min(1).max(80).optional(),
  emoji: z.string().max(16).nullable().optional(),
  model: z.string().max(200).nullable().optional(),
  instructions: z.string().max(20_000).optional(),
});

/**
 * PUT /api/brains/template — updates the org's Brain Agent Template, then
 * re-patches every brain agent already provisioned in the org
 * (`fanOutTemplate`) — the "reconfigure once, all impacted" guarantee.
 * Fan-out failures are returned per-agent, never abort the save.
 */
export const PUT: RequestHandler = async ({ locals, request }) => {
  await requireOrgCapability(locals, 'brains', 'manage');
  const ctx = await requireCoreCtx(locals);
  const body = await parseBody(request, putSchema);
  const actor = { id: ctx.profileId ?? null, name: locals.user?.displayName ?? locals.user?.email ?? null };
  const template = await updateTemplate(ctx, body, actor);
  const fanOut = await fanOutTemplate(ctx);
  return json({ template, fanOut });
};
