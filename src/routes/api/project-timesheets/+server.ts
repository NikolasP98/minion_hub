import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { listTimesheets, createTimesheet } from '$server/services/projects.service';

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
  const body = await request.json();
  if (!body?.partyId || !body?.spentDate || typeof body?.minutes !== 'number') {
    throw error(400, 'partyId, spentDate, minutes required');
  }
  if (body.minutes <= 0) throw error(400, 'minutes must be positive');
  return json(await createTimesheet(ctx, body), { status: 201 });
};
