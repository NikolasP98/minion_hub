import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { requireAuth } from '$server/auth/authorize';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import { parseBody } from '$server/api/validate';
import { decidePulseProposal, editPulseProposal } from '$server/services/pulse.service';

const postSchema = z
  .object({
    action: z.enum(['approve', 'dismiss']),
    expectedRevision: z.number().int().positive().optional(),
  })
  .strict();
const patchSchema = z
  .object({
    args: z.record(z.string(), z.unknown()),
    expectedRevision: z.number().int().positive().optional(),
  })
  .strict();
export const POST: RequestHandler = async ({ locals, params, request }) => {
  requireAuth(locals);
  await requireOrgCapability(locals, 'pulse', 'edit');
  const ctx = await requireCoreCtx(locals);
  const { action, expectedRevision } = await parseBody(request, postSchema);
  return json(await decidePulseProposal(ctx, params.id, action, expectedRevision));
};
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  requireAuth(locals);
  await requireOrgCapability(locals, 'pulse', 'edit');
  const ctx = await requireCoreCtx(locals);
  const { args, expectedRevision } = await parseBody(request, patchSchema);
  if (expectedRevision === undefined) throw error(409, 'refresh_required');
  return json({ proposal: await editPulseProposal(ctx, params.id, args, expectedRevision) });
};
