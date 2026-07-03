import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { listTasks, createTask, TASK_STATUSES, type TaskStatus } from '$server/services/projects.service';

// Mirrors TaskPriority in projects.service.ts.
const postSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(20_000).nullable().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  assigneePartyId: z.string().max(200).nullable().optional(),
  parentId: z.string().max(200).nullable().optional(),
  milestoneId: z.string().max(200).nullable().optional(),
  isMilestone: z.boolean().optional(),
  estMinutes: z.coerce.number().nullable().optional(),
  sortOrder: z.coerce.number().optional(),
});

/** GET /api/projects/:id/tasks?status=&assignee=&milestones= */
export const GET: RequestHandler = async ({ locals, params, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  return json(
    await listTasks(ctx, {
      projectId: params.id!,
      status: (url.searchParams.get('status') as TaskStatus) ?? undefined,
      assigneePartyId: url.searchParams.get('assignee') ?? undefined,
      includeMilestones: url.searchParams.get('milestones') === '1',
    }),
  );
};

/** POST /api/projects/:id/tasks — { title, ... } */
export const POST: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await parseBody(request, postSchema);
  const actor = { id: ctx.profileId ?? null, name: locals.user?.displayName ?? locals.user?.email ?? null, email: locals.user?.email ?? null };
  const task = await createTask(ctx, { ...body, projectId: params.id! }, actor);
  return json(task, { status: 201 });
};
