import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { getProject, updateProject, PROJECT_STATUSES } from '$server/services/projects.service';
import { StaleWriteError } from '$server/services/errors';

const patchSchema = z.object({
  name: z.string().min(1).max(500).optional(),
  description: z.string().max(20_000).nullable().optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  customerPartyId: z.string().max(200).nullable().optional(),
  leadPartyId: z.string().max(200).nullable().optional(),
  color: z.string().max(50).nullable().optional(),
  icon: z.string().max(100).nullable().optional(),
  targetDate: z.string().max(60).nullable().optional(),
  workforceProjectId: z.string().max(200).nullable().optional(),
  expectedUpdatedAt: z.coerce.date().optional(),
});

/** GET /api/projects/:id */
export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const project = await getProject(ctx, params.id!);
  if (!project) throw error(404);
  return json(project);
};

/** PATCH /api/projects/:id */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await parseBody(request, patchSchema);
  const actor = { id: ctx.profileId ?? null, name: locals.user?.displayName ?? locals.user?.email ?? null };
  try {
    const project = await updateProject(ctx, params.id!, body, actor, body.expectedUpdatedAt);
    if (!project) throw error(404);
    return json(project);
  } catch (e) {
    if (e instanceof StaleWriteError) return json({ error: 'stale', current: e.current }, { status: 409 });
    throw e;
  }
};
