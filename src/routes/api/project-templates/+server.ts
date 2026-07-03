import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { listTemplates, createTemplate } from '$server/services/projects.service';
import type { ProjectTemplateSpec } from '$server/db/pg-projects-schema';

const postSchema = z.object({
  name: z.string().min(1).max(500),
  description: z.string().max(20_000).nullable().optional(),
  spec: z.unknown().optional(),
});

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
  const body = await parseBody(request, postSchema);
  return json(
    await createTemplate(ctx, { name: body.name, description: body.description, spec: (body.spec ?? {}) as ProjectTemplateSpec }),
    { status: 201 },
  );
};
