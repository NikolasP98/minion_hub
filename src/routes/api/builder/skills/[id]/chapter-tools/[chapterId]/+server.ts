import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getChapterTools, setChapterTools } from '$server/services/builder.service';
import { requireCoreCtx } from '$server/auth/core-ctx';
import {
  requireBuilderCapability,
  requireBuilderOwnership,
  requireBuilderSkillChild,
} from '$server/services/builder-access';

/** GET /api/builder/skills/:id/chapter-tools/:chapterId */
export const GET: RequestHandler = async ({ locals, params }) => {
  await requireBuilderCapability(locals, 'view');
  const ctx = await requireCoreCtx(locals);
  await requireBuilderOwnership(locals, ctx, 'skill', params.id!);
  await requireBuilderSkillChild(ctx, params.id!, 'chapter', params.chapterId!);
  const tools = await getChapterTools(ctx, params.chapterId!);
  return json({ toolIds: tools.map((t) => t.toolId) });
};

/** PUT /api/builder/skills/:id/chapter-tools/:chapterId */
export const PUT: RequestHandler = async ({ locals, params, request }) => {
  await requireBuilderCapability(locals, 'edit');
  const ctx = await requireCoreCtx(locals);
  await requireBuilderOwnership(locals, ctx, 'skill', params.id!);
  await requireBuilderSkillChild(ctx, params.id!, 'chapter', params.chapterId!);
  const body = await request.json();
  await setChapterTools(ctx, params.chapterId!, body.toolIds ?? []);
  return json({ ok: true });
};
