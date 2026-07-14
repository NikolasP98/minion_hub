import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import {
  getBuiltSkill,
  updateBuiltSkill,
  deleteBuiltSkill,
  publishBuiltSkill,
  getSkillTools,
  addSkillTool,
  removeSkillTool,
  getChapters,
  createChapter,
  updateChapter,
  deleteChapter,
  getChapterEdges,
  createChapterEdge,
  deleteChapterEdge,
  validateSkillForPublish,
} from '$server/services/builder.service';
import { requireCoreCtx } from '$server/auth/core-ctx';
import {
  requireBuilderCapability,
  requireBuilderOwnership,
  requireBuilderSkillChild,
} from '$server/services/builder-access';

/** GET /api/builder/skills/:id — full skill with tools, chapters, edges */
export const GET: RequestHandler = async ({ locals, params }) => {
  await requireBuilderCapability(locals, 'view');
  const ctx = await requireCoreCtx(locals);
  await requireBuilderOwnership(locals, ctx, 'skill', params.id!);

  const skill = await getBuiltSkill(ctx, params.id!);
  if (!skill) throw error(404, 'Skill not found');

  const [tools, chapters, edges] = await Promise.all([
    getSkillTools(ctx, params.id!),
    getChapters(ctx, params.id!),
    getChapterEdges(ctx, params.id!),
  ]);

  return json({ skill, tools, chapters, edges });
};

/** PUT /api/builder/skills/:id — update skill metadata */
export const PUT: RequestHandler = async ({ locals, params, request }) => {
  await requireBuilderCapability(locals, 'edit');
  const ctx = await requireCoreCtx(locals);
  await requireBuilderOwnership(locals, ctx, 'skill', params.id!);

  const body = await request.json();
  const { action } = body;

  // Dispatch on action type
  if (action === 'publish') {
    const validation = await validateSkillForPublish(ctx, params.id!);
    if (!validation.valid) {
      return json({ ok: false, errors: validation.errors }, { status: 400 });
    }
    await publishBuiltSkill(ctx, params.id!);
    return json({ ok: true });
  }

  if (action === 'add-tool') {
    await addSkillTool(ctx, params.id!, body.toolId);
    return json({ ok: true });
  }

  if (action === 'remove-tool') {
    await removeSkillTool(ctx, params.id!, body.toolId);
    return json({ ok: true });
  }

  if (action === 'add-chapter') {
    const { id } = await createChapter(ctx, params.id!, body);
    return json({ id });
  }

  if (action === 'update-chapter') {
    await requireBuilderSkillChild(ctx, params.id!, 'chapter', body.chapterId);
    await updateChapter(ctx, body.chapterId, body.data);
    return json({ ok: true });
  }

  if (action === 'delete-chapter') {
    await requireBuilderSkillChild(ctx, params.id!, 'chapter', body.chapterId);
    await deleteChapter(ctx, body.chapterId);
    return json({ ok: true });
  }

  if (action === 'add-edge') {
    await Promise.all([
      requireBuilderSkillChild(ctx, params.id!, 'chapter', body.sourceChapterId),
      requireBuilderSkillChild(ctx, params.id!, 'chapter', body.targetChapterId),
    ]);
    const { id } = await createChapterEdge(
      ctx,
      params.id!,
      body.sourceChapterId,
      body.targetChapterId,
      body.label,
    );
    return json({ id });
  }

  if (action === 'delete-edge') {
    await requireBuilderSkillChild(ctx, params.id!, 'edge', body.edgeId);
    await deleteChapterEdge(ctx, body.edgeId);
    return json({ ok: true });
  }

  // Default: update skill metadata
  await updateBuiltSkill(ctx, params.id!, body);
  return json({ ok: true });
};

/** DELETE /api/builder/skills/:id */
export const DELETE: RequestHandler = async ({ locals, params }) => {
  await requireBuilderCapability(locals, 'delete');
  const ctx = await requireCoreCtx(locals);
  await requireBuilderOwnership(locals, ctx, 'skill', params.id!);
  await deleteBuiltSkill(ctx, params.id!);
  return json({ ok: true });
};
