import { eq, and, desc, inArray } from 'drizzle-orm';
import {
  builtSkills,
  builtSkillTools,
  builtChapters,
  builtChapterEdges,
  builtChapterTools,
  builtAgents,
  builtAgentSkills,
  builtTools,
  agentBuiltSkills,
} from '@minion-stack/db/pg';
import { invalidateTags, tags } from '@minion-stack/cache';
import { newId } from '$server/db/utils';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { resolveGatewayId } from '$server/services/gateway.pg.service';
import { validateSkill } from '$lib/utils/skill-validation';

// ── Built Skills ──────────────────────────────────────────────────────

export interface CreateSkillInput {
  name: string;
  description?: string;
  emoji?: string;
  serverId?: string;
  maxCycles?: number;
}

export async function createBuiltSkill(ctx: CoreCtx, input: CreateSkillInput) {
  const id = newId();
  const gatewayId = input.serverId ? await resolveGatewayId(input.serverId) : null;
  await withOrgCore(ctx, (tx) =>
    tx.insert(builtSkills).values({
      id,
      name: input.name,
      description: input.description ?? '',
      emoji: input.emoji ?? '📖',
      status: 'draft',
      gatewayId,
      tenantId: ctx.tenantId,
      createdBy: null,
    }),
  );
  return { id };
}

export async function listBuiltSkills(
  ctx: CoreCtx,
  opts?: { status?: 'draft' | 'published' },
) {
  const conditions = [eq(builtSkills.tenantId, ctx.tenantId)];
  if (opts?.status) conditions.push(eq(builtSkills.status, opts.status));
  return withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(builtSkills)
      .where(and(...conditions))
      .orderBy(desc(builtSkills.updatedAt)),
  );
}

export async function getBuiltSkill(ctx: CoreCtx, skillId: string) {
  const rows = await withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(builtSkills)
      .where(and(eq(builtSkills.id, skillId), eq(builtSkills.tenantId, ctx.tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function updateBuiltSkill(
  ctx: CoreCtx,
  skillId: string,
  data: Partial<CreateSkillInput>,
) {
  const { serverId, ...rest } = data;
  const set: Record<string, unknown> = { ...rest, updatedAt: new Date() };
  if (serverId !== undefined) set.gatewayId = serverId ? await resolveGatewayId(serverId) : null;
  await withOrgCore(ctx, (tx) =>
    tx
      .update(builtSkills)
      .set(set)
      .where(and(eq(builtSkills.id, skillId), eq(builtSkills.tenantId, ctx.tenantId))),
  );
}

export async function deleteBuiltSkill(ctx: CoreCtx, skillId: string) {
  await withOrgCore(ctx, (tx) =>
    tx
      .delete(builtSkills)
      .where(and(eq(builtSkills.id, skillId), eq(builtSkills.tenantId, ctx.tenantId))),
  );
}

export async function publishBuiltSkill(ctx: CoreCtx, skillId: string) {
  const now = new Date();
  await withOrgCore(ctx, (tx) =>
    tx
      .update(builtSkills)
      .set({ status: 'published', publishedAt: now, updatedAt: now })
      .where(and(eq(builtSkills.id, skillId), eq(builtSkills.tenantId, ctx.tenantId))),
  );
}

// ── Publish Validation ────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export async function validateSkillForPublish(
  ctx: CoreCtx,
  skillId: string,
): Promise<ValidationResult> {
  const skill = await getBuiltSkill(ctx, skillId);
  if (!skill) return { valid: false, errors: ['Skill not found'] };

  const chapters = await getChapters(ctx, skillId);
  const edges = chapters.length > 1 ? await getChapterEdges(ctx, skillId) : [];

  // Build chapterToolMap from DB — batch query for all chapter-type nodes
  const chapterToolMap: Record<string, string[]> = {};
  const chapterOnlyNodes = chapters.filter((c) => c.type === 'chapter');
  if (chapterOnlyNodes.length > 0) {
    const chapterIds = chapterOnlyNodes.map((c) => c.id);
    const allTools = await withOrgCore(ctx, (tx) =>
      tx
        .select({ chapterId: builtChapterTools.chapterId, toolId: builtChapterTools.toolId })
        .from(builtChapterTools)
        .where(inArray(builtChapterTools.chapterId, chapterIds)),
    );
    for (const t of allTools) {
      if (!chapterToolMap[t.chapterId]) chapterToolMap[t.chapterId] = [];
      chapterToolMap[t.chapterId].push(t.toolId);
    }
    // Ensure chapters with no tools have empty arrays
    for (const ch of chapterOnlyNodes) {
      if (!chapterToolMap[ch.id]) chapterToolMap[ch.id] = [];
    }
  }

  const findings = validateSkill({
    name: skill.name ?? '',
    description: skill.description ?? '',
    chapters: chapters.map((ch) => ({
      id: ch.id,
      name: ch.name,
      type: ch.type ?? 'chapter',
      guide: ch.guide ?? '',
      conditionText: ch.conditionText ?? '',
      outputDef: ch.outputDef ?? '',
    })),
    edges: edges.map((e) => ({
      sourceChapterId: e.sourceChapterId,
      targetChapterId: e.targetChapterId,
    })),
    chapterToolMap,
  });

  const errors = findings.filter((f) => f.level === 'error').map((f) => f.message);
  return { valid: errors.length === 0, errors };
}

// ── Skill Tools (pool) ───────────────────────────────────────────────

export async function getSkillTools(ctx: CoreCtx, skillId: string) {
  return withOrgCore(ctx, (tx) =>
    tx.select().from(builtSkillTools).where(eq(builtSkillTools.skillId, skillId)),
  );
}

export async function addSkillTool(ctx: CoreCtx, skillId: string, toolId: string) {
  await withOrgCore(ctx, (tx) =>
    tx.insert(builtSkillTools).values({ id: newId(), skillId, toolId }),
  );
}

export async function removeSkillTool(ctx: CoreCtx, skillId: string, toolId: string) {
  await withOrgCore(ctx, (tx) =>
    tx
      .delete(builtSkillTools)
      .where(and(eq(builtSkillTools.skillId, skillId), eq(builtSkillTools.toolId, toolId))),
  );
}

// ── Chapters ─────────────────────────────────────────────────────────

export async function getChapters(ctx: CoreCtx, skillId: string) {
  return withOrgCore(ctx, (tx) =>
    tx.select().from(builtChapters).where(eq(builtChapters.skillId, skillId)),
  );
}

export async function createChapter(
  ctx: CoreCtx,
  skillId: string,
  data: {
    name: string;
    type?: string;
    conditionText?: string;
    positionX?: number;
    positionY?: number;
  },
) {
  const id = newId();
  await withOrgCore(ctx, (tx) =>
    tx.insert(builtChapters).values({
      id,
      skillId,
      name: data.name,
      type: (data.type as 'chapter' | 'condition') ?? 'chapter',
      conditionText: data.conditionText ?? '',
      positionX: data.positionX ?? 0,
      positionY: data.positionY ?? 0,
    }),
  );
  return { id };
}

export async function updateChapter(
  ctx: CoreCtx,
  chapterId: string,
  data: Partial<{
    name: string;
    description: string;
    guide: string;
    context: string;
    outputDef: string;
    conditionText: string;
    positionX: number;
    positionY: number;
  }>,
) {
  await withOrgCore(ctx, (tx) =>
    tx
      .update(builtChapters)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(builtChapters.id, chapterId)),
  );
}

export async function deleteChapter(ctx: CoreCtx, chapterId: string) {
  await withOrgCore(ctx, (tx) =>
    tx.delete(builtChapters).where(eq(builtChapters.id, chapterId)),
  );
}

// ── Chapter Edges ────────────────────────────────────────────────────

export async function getChapterEdges(ctx: CoreCtx, skillId: string) {
  return withOrgCore(ctx, (tx) =>
    tx.select().from(builtChapterEdges).where(eq(builtChapterEdges.skillId, skillId)),
  );
}

export async function createChapterEdge(
  ctx: CoreCtx,
  skillId: string,
  sourceChapterId: string,
  targetChapterId: string,
  label?: string,
) {
  const id = newId();
  await withOrgCore(ctx, (tx) =>
    tx
      .insert(builtChapterEdges)
      .values({ id, skillId, sourceChapterId, targetChapterId, label: label ?? null }),
  );
  return { id };
}

export async function deleteChapterEdge(ctx: CoreCtx, edgeId: string) {
  await withOrgCore(ctx, (tx) =>
    tx.delete(builtChapterEdges).where(eq(builtChapterEdges.id, edgeId)),
  );
}

// ── Chapter Tools ────────────────────────────────────────────────────

export async function getChapterTools(ctx: CoreCtx, chapterId: string) {
  return withOrgCore(ctx, (tx) =>
    tx.select().from(builtChapterTools).where(eq(builtChapterTools.chapterId, chapterId)),
  );
}

export async function setChapterTools(ctx: CoreCtx, chapterId: string, toolIds: string[]) {
  await withOrgCore(ctx, async (tx) => {
    await tx.delete(builtChapterTools).where(eq(builtChapterTools.chapterId, chapterId));
    if (toolIds.length > 0) {
      await tx
        .insert(builtChapterTools)
        .values(toolIds.map((toolId) => ({ id: newId(), chapterId, toolId })));
    }
  });
}

// ── Built Agents ─────────────────────────────────────────────────────

export async function listBuiltAgents(ctx: CoreCtx) {
  return withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(builtAgents)
      .where(eq(builtAgents.tenantId, ctx.tenantId))
      .orderBy(desc(builtAgents.updatedAt)),
  );
}

export async function createBuiltAgent(
  ctx: CoreCtx,
  input: {
    name: string;
    emoji?: string;
    description?: string;
    model?: string;
    systemPrompt?: string;
    serverId?: string;
  },
) {
  const id = newId();
  const gatewayId = input.serverId ? await resolveGatewayId(input.serverId) : null;
  await withOrgCore(ctx, (tx) =>
    tx.insert(builtAgents).values({
      id,
      name: input.name,
      emoji: input.emoji ?? '🤖',
      description: input.description ?? '',
      model: input.model ?? null,
      systemPrompt: input.systemPrompt ?? '',
      status: 'draft',
      gatewayId,
      tenantId: ctx.tenantId,
    }),
  );
  return { id };
}

// ── Built Tools ──────────────────────────────────────────────────────

export async function listBuiltTools(ctx: CoreCtx, opts?: { status?: 'draft' | 'published' }) {
  const conditions = [eq(builtTools.tenantId, ctx.tenantId)];
  if (opts?.status) conditions.push(eq(builtTools.status, opts.status));
  return withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(builtTools)
      .where(and(...conditions))
      .orderBy(desc(builtTools.updatedAt)),
  );
}

export async function getBuiltTool(ctx: CoreCtx, toolId: string) {
  const rows = await withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(builtTools)
      .where(and(eq(builtTools.id, toolId), eq(builtTools.tenantId, ctx.tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function updateBuiltTool(
  ctx: CoreCtx,
  toolId: string,
  data: Partial<{
    name: string;
    description: string;
    scriptCode: string;
    scriptLang: 'javascript' | 'python' | 'bash';
    envVars: string;
    validationRules: string;
    executionConfig: string;
  }>,
) {
  await withOrgCore(ctx, (tx) =>
    tx
      .update(builtTools)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(builtTools.id, toolId), eq(builtTools.tenantId, ctx.tenantId))),
  );
  // Drop the cached tools list (GET /api/builder/tools) so the edit shows up.
  await invalidateTags(tags.tenantDomain(ctx.tenantId, 'builder'));
}

export async function deleteBuiltTool(ctx: CoreCtx, toolId: string) {
  await withOrgCore(ctx, (tx) =>
    tx
      .delete(builtTools)
      .where(and(eq(builtTools.id, toolId), eq(builtTools.tenantId, ctx.tenantId))),
  );
  await invalidateTags(tags.tenantDomain(ctx.tenantId, 'builder'));
}

export async function publishBuiltTool(ctx: CoreCtx, toolId: string) {
  const now = new Date();
  await withOrgCore(ctx, (tx) =>
    tx
      .update(builtTools)
      .set({ status: 'published', publishedAt: now, updatedAt: now })
      .where(and(eq(builtTools.id, toolId), eq(builtTools.tenantId, ctx.tenantId))),
  );
  await invalidateTags(tags.tenantDomain(ctx.tenantId, 'builder'));
}

// ── Agent Built Skills (gateway agent → built skill mapping) ─────────

export async function setAgentBuiltSkills(
  ctx: CoreCtx,
  gatewayAgentId: string,
  serverId: string,
  skillIds: string[],
) {
  const gatewayId = await resolveGatewayId(serverId);
  if (!gatewayId) return;
  await withOrgCore(ctx, async (tx) => {
    await tx
      .delete(agentBuiltSkills)
      .where(
        and(
          eq(agentBuiltSkills.gatewayAgentId, gatewayAgentId),
          eq(agentBuiltSkills.gatewayId, gatewayId),
          eq(agentBuiltSkills.tenantId, ctx.tenantId),
        ),
      );
    if (skillIds.length > 0) {
      await tx.insert(agentBuiltSkills).values(
        skillIds.map((skillId, i) => ({
          id: newId(),
          gatewayAgentId,
          gatewayId,
          tenantId: ctx.tenantId,
          skillId,
          position: i,
        })),
      );
    }
  });
}
