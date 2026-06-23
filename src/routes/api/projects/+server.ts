import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { listProjects, createProject, PROJECT_STATUSES, type ProjectStatus } from '$server/services/projects.service';

function actorOf(ctx: { profileId?: string }, locals: App.Locals) {
  return { id: ctx.profileId ?? null, name: locals.user?.displayName ?? locals.user?.email ?? null };
}

/** GET /api/projects?status=&customer= */
export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'projects'))) throw error(404);
  return json(
    await listProjects(ctx, {
      status: (url.searchParams.get('status') as ProjectStatus) ?? undefined,
      customerPartyId: url.searchParams.get('customer') ?? undefined,
    }),
  );
};

/** POST /api/projects — { name, description?, customerPartyId?, leadPartyId?, targetDate?, status? } */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'projects'))) throw error(404);
  const body = await request.json();
  if (!body?.name || typeof body.name !== 'string') throw error(400, 'name required');
  if (body.status && !PROJECT_STATUSES.includes(body.status)) throw error(400, 'invalid status');
  const project = await createProject(ctx, body, actorOf(ctx, locals));
  return json(project, { status: 201 });
};
