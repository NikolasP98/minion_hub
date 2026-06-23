import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { listTemplates, createTemplate } from '$server/services/projects.service';

/** GET /api/project-templates */
export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  return json(await listTemplates(ctx));
};

/** POST /api/project-templates — { name, description?, spec } */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'projects'))) throw error(404);
  const body = await request.json();
  if (!body?.name || typeof body.name !== 'string') throw error(400, 'name required');
  return json(await createTemplate(ctx, { name: body.name, description: body.description, spec: body.spec ?? {} }), {
    status: 201,
  });
};
