import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getChapterTools, setChapterTools } from '$server/services/builder.service';
import { requireCoreCtx } from '$server/auth/core-ctx';

/** GET /api/builder/skills/:id/chapter-tools/:chapterId */
export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await requireCoreCtx(locals);
  if (!ctx) throw error(401);
  const tools = await getChapterTools(ctx, params.chapterId!);
  return json({ toolIds: tools.map((t) => t.toolId) });
};

/** PUT /api/builder/skills/:id/chapter-tools/:chapterId */
export const PUT: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await requireCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await request.json();
  await setChapterTools(ctx, params.chapterId!, body.toolIds ?? []);
  return json({ ok: true });
};
