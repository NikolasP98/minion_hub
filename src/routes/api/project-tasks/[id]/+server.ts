import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { updateTask, TASK_STATUSES } from '$server/services/projects.service';
import { StaleWriteError } from '$server/services/errors';

// Mirrors TaskPriority in projects.service.ts.
const patchSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(20_000).nullable().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  assigneePartyId: z.string().max(200).nullable().optional(),
  parentId: z.string().max(200).nullable().optional(),
  milestoneId: z.string().max(200).nullable().optional(),
  isMilestone: z.boolean().optional(),
  estMinutes: z.coerce.number().nullable().optional(),
  sortOrder: z.coerce.number().optional(),
  expectedUpdatedAt: z.coerce.date().optional(),
});

/** PATCH /api/project-tasks/:id — update status/assignee/priority/etc. */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await parseBody(request, patchSchema);
  const actor = { id: ctx.profileId ?? null, name: locals.user?.displayName ?? locals.user?.email ?? null, email: locals.user?.email ?? null };
  try {
    const task = await updateTask(ctx, params.id!, body, actor, body.expectedUpdatedAt);
    if (!task) throw error(404);
    return json(task);
  } catch (e) {
    if (e instanceof StaleWriteError) return json({ error: 'stale', current: e.current }, { status: 409 });
    throw e;
  }
};
