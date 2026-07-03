import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { listTimesheets, createTimesheet } from '$server/services/projects.service';

const postSchema = z.object({
  projectId: z.string().max(200).nullable().optional(),
  taskId: z.string().max(200).nullable().optional(),
  partyId: z.string().min(1).max(200),
  spentDate: z.string().min(1).max(60),
  minutes: z.number().positive(),
  description: z.string().max(20_000).nullable().optional(),
  billable: z.boolean().optional(),
  billingRateCents: z.coerce.number().nullable().optional(),
});

/** GET /api/project-timesheets?project=&task=&party= */
export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  return json(
    await listTimesheets(ctx, {
      projectId: url.searchParams.get('project') ?? undefined,
      taskId: url.searchParams.get('task') ?? undefined,
      partyId: url.searchParams.get('party') ?? undefined,
    }),
  );
};

/** POST /api/project-timesheets — { partyId, spentDate, minutes, projectId?, taskId?, billable? } */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'projects'))) throw error(404);
  const body = await parseBody(request, postSchema);
  return json(await createTimesheet(ctx, body), { status: 201 });
};
