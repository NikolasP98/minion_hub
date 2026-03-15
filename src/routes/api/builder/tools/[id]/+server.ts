import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getOrCreateTenantCtx } from '$server/auth/tenant-ctx';
import { getBuiltTool, updateBuiltTool, deleteBuiltTool, publishBuiltTool } from '$server/services/builder.service';

/** GET /api/builder/tools/:id — full tool record */
export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await getOrCreateTenantCtx(locals);
  if (!ctx) throw error(401);

  const tool = await getBuiltTool(ctx, params.id!);
  if (!tool) throw error(404, 'Tool not found');

  return json({ tool });
};

/** PUT /api/builder/tools/:id — update tool or publish */
export const PUT: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getOrCreateTenantCtx(locals);
  if (!ctx) throw error(401);

  const body = await request.json();
  const { action } = body;

  if (action === 'publish') {
    await publishBuiltTool(ctx, params.id!);
    return json({ ok: true });
  }

  // Default: update tool metadata
  const { name, description, scriptCode, scriptLang, envVars, validationRules, executionConfig } = body;
  await updateBuiltTool(ctx, params.id!, {
    ...(name !== undefined && { name }),
    ...(description !== undefined && { description }),
    ...(scriptCode !== undefined && { scriptCode }),
    ...(scriptLang !== undefined && { scriptLang }),
    ...(envVars !== undefined && { envVars }),
    ...(validationRules !== undefined && { validationRules }),
    ...(executionConfig !== undefined && { executionConfig }),
  });

  return json({ ok: true });
};

/** DELETE /api/builder/tools/:id */
export const DELETE: RequestHandler = async ({ locals, params }) => {
  const ctx = await getOrCreateTenantCtx(locals);
  if (!ctx) throw error(401);
  await deleteBuiltTool(ctx, params.id!);
  return json({ ok: true });
};
