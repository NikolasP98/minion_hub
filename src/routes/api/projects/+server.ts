import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { listProjects, createProject, PROJECT_STATUSES, type ProjectStatus } from '$server/services/projects.service';

function actorOf(ctx: { profileId?: string }, locals: App.Locals) {
  return { id: ctx.profileId ?? null, name: locals.user?.displayName ?? locals.user?.email ?? null };
}

const postSchema = z.object({
  name: z.string().min(1).max(500),
  description: z.string().max(20_000).nullable().optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  customerPartyId: z.string().max(200).nullable().optional(),
  leadPartyId: z.string().max(200).nullable().optional(),
  color: z.string().max(50).nullable().optional(),
  icon: z.string().max(100).nullable().optional(),
  targetDate: z.string().max(60).nullable().optional(),
  workforceProjectId: z.string().max(200).nullable().optional(),
});

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
  const body = await parseBody(request, postSchema);
  const project = await createProject(ctx, body, actorOf(ctx, locals));
  return json(project, { status: 201 });
};
