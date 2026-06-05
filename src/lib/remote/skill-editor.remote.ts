/**
 * Remote functions for the skill editor (skill-editor.core.svelte.ts).
 * Mirrors `/api/builder/skills/[id]` (GET + action-dispatch PUT + DELETE) and
 * `/api/builder/skills/[id]/chapter-tools/[chapterId]`.
 *
 * Headline win: `getChapterTools` is a **query.batch**, collapsing the previous
 * N+1 (one chapter-tools fetch per chapter during skill load) into a single
 * request. The AI endpoints (`/api/builder/ai/*`) are intentionally NOT migrated.
 *
 * Routes use the auto-provisioning tenant ctx (`currentOrCreateCtx`).
 */
import { query, command } from '$app/server';
import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { currentOrCreateCtx } from '$server/remote/guard';
import {
  getBuiltSkill,
  updateBuiltSkill,
  deleteBuiltSkill,
  publishBuiltSkill,
  getSkillTools,
  getChapters,
  createChapter,
  updateChapter,
  deleteChapter,
  getChapterEdges,
  createChapterEdge,
  deleteChapterEdge,
  validateSkillForPublish,
  getChapterTools as svcGetChapterTools,
  setChapterTools as svcSetChapterTools,
} from '$server/services/builder.service';

/** Full skill with tools, chapters and edges (replaces the skill-load GET). */
export const getSkillDetail = query(z.string().min(1), async (skillId) => {
  const ctx = await currentOrCreateCtx();
  const skill = await getBuiltSkill(ctx, skillId);
  if (!skill) error(404, 'Skill not found');
  const [tools, chapters, edges] = await Promise.all([
    getSkillTools(ctx, skillId),
    getChapters(ctx, skillId),
    getChapterEdges(ctx, skillId),
  ]);
  return { skill, tools, chapters, edges };
});

/**
 * Tool ids for a chapter — BATCHED. Calling this once per chapter during skill
 * load now results in a single round-trip (was one fetch per chapter = N+1).
 */
export const getChapterTools = query.batch(z.string().min(1), async (chapterIds) => {
  const ctx = await currentOrCreateCtx();
  const entries = await Promise.all(
    chapterIds.map(
      async (cid) => [cid, (await svcGetChapterTools(ctx, cid)).map((t) => t.toolId)] as const,
    ),
  );
  const lookup = new Map<string, string[]>(entries);
  return (chapterId: string) => lookup.get(chapterId) ?? [];
});

const chapterData = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  guide: z.string().optional(),
  context: z.string().optional(),
  outputDef: z.string().optional(),
  conditionText: z.string().optional(),
  positionX: z.number().optional(),
  positionY: z.number().optional(),
});

/** Update skill metadata (name/description/emoji/maxCycles). */
export const updateSkillMeta = command(
  z.object({
    skillId: z.string().min(1),
    name: z.string().optional(),
    description: z.string().optional(),
    emoji: z.string().optional(),
    maxCycles: z.number().optional(),
    serverId: z.string().optional(),
  }),
  async ({ skillId, ...data }) => {
    const ctx = await currentOrCreateCtx();
    await updateBuiltSkill(ctx, skillId, data);
    return { ok: true as const };
  },
);

/** Validate + publish. Returns `{ ok, errors? }` (does not throw on invalid). */
export const publishSkill = command(z.string().min(1), async (skillId) => {
  const ctx = await currentOrCreateCtx();
  const validation = await validateSkillForPublish(ctx, skillId);
  if (!validation.valid) return { ok: false as const, errors: validation.errors };
  await publishBuiltSkill(ctx, skillId);
  return { ok: true as const };
});

/** Create a chapter (or condition). Returns `{ id }`. */
export const addChapter = command(
  z.object({
    skillId: z.string().min(1),
    name: z.string().min(1),
    type: z.string().optional(),
    conditionText: z.string().optional(),
    positionX: z.number().optional(),
    positionY: z.number().optional(),
  }),
  async ({ skillId, ...data }) => {
    const ctx = await currentOrCreateCtx();
    return createChapter(ctx, skillId, data);
  },
);

/** Update a chapter's fields. */
export const updateChapterFields = command(
  z.object({ chapterId: z.string().min(1), data: chapterData }),
  async ({ chapterId, data }) => {
    const ctx = await currentOrCreateCtx();
    await updateChapter(ctx, chapterId, data);
    return { ok: true as const };
  },
);

/** Delete a chapter. */
export const removeChapter = command(z.string().min(1), async (chapterId) => {
  const ctx = await currentOrCreateCtx();
  await deleteChapter(ctx, chapterId);
  return { ok: true as const };
});

/** Connect two chapters with an edge. Returns `{ id }`. */
export const addChapterEdge = command(
  z.object({
    skillId: z.string().min(1),
    sourceChapterId: z.string().min(1),
    targetChapterId: z.string().min(1),
    label: z.string().nullish(),
  }),
  async ({ skillId, sourceChapterId, targetChapterId, label }) => {
    const ctx = await currentOrCreateCtx();
    return createChapterEdge(ctx, skillId, sourceChapterId, targetChapterId, label ?? undefined);
  },
);

/** Delete an edge. */
export const removeChapterEdge = command(z.string().min(1), async (edgeId) => {
  const ctx = await currentOrCreateCtx();
  await deleteChapterEdge(ctx, edgeId);
  return { ok: true as const };
});

/** Replace a chapter's tool set. */
export const setChapterTools = command(
  z.object({ chapterId: z.string().min(1), toolIds: z.array(z.string()) }),
  async ({ chapterId, toolIds }) => {
    const ctx = await currentOrCreateCtx();
    await svcSetChapterTools(ctx, chapterId, toolIds);
    return { ok: true as const };
  },
);

/** Delete an entire skill. */
export const deleteSkill = command(z.string().min(1), async (skillId) => {
  const ctx = await currentOrCreateCtx();
  await deleteBuiltSkill(ctx, skillId);
  return { ok: true as const };
});
