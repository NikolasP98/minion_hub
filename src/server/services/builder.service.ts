import { eq, and, desc } from 'drizzle-orm';
import { builtSkills, builtSkillTools, builtChapters, builtChapterEdges, builtChapterTools, builtAgents, builtAgentSkills, builtTools } from '$server/db/schema';
import { newId, nowMs } from '$server/db/utils';
import type { TenantContext } from './base';

// ── Built Skills ──────────────────────────────────────────────────────

export interface CreateSkillInput {
  name: string;
  description?: string;
  emoji?: string;
  serverId?: string;
}

export async function createBuiltSkill(ctx: TenantContext, input: CreateSkillInput) {
  const now = nowMs();
  const id = newId();
  await ctx.db.insert(builtSkills).values({
    id,
    name: input.name,
    description: input.description ?? '',
    emoji: input.emoji ?? '📖',
    status: 'draft',
    serverId: input.serverId ?? null,
    tenantId: ctx.tenantId,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
  });
  return { id };
}

export async function listBuiltSkills(ctx: TenantContext) {
  return ctx.db
    .select()
    .from(builtSkills)
    .where(eq(builtSkills.tenantId, ctx.tenantId))
    .orderBy(desc(builtSkills.updatedAt));
}

export async function getBuiltSkill(ctx: TenantContext, skillId: string) {
  const rows = await ctx.db
    .select()
    .from(builtSkills)
    .where(and(eq(builtSkills.id, skillId), eq(builtSkills.tenantId, ctx.tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateBuiltSkill(ctx: TenantContext, skillId: string, data: Partial<CreateSkillInput>) {
  await ctx.db
    .update(builtSkills)
    .set({ ...data, updatedAt: nowMs() })
    .where(and(eq(builtSkills.id, skillId), eq(builtSkills.tenantId, ctx.tenantId)));
}

export async function deleteBuiltSkill(ctx: TenantContext, skillId: string) {
  await ctx.db
    .delete(builtSkills)
    .where(and(eq(builtSkills.id, skillId), eq(builtSkills.tenantId, ctx.tenantId)));
}

export async function publishBuiltSkill(ctx: TenantContext, skillId: string) {
  const now = nowMs();
  await ctx.db
    .update(builtSkills)
    .set({ status: 'published', publishedAt: now, updatedAt: now })
    .where(and(eq(builtSkills.id, skillId), eq(builtSkills.tenantId, ctx.tenantId)));
}

// ── Skill Tools (pool) ───────────────────────────────────────────────

export async function getSkillTools(ctx: TenantContext, skillId: string) {
  return ctx.db
    .select()
    .from(builtSkillTools)
    .where(eq(builtSkillTools.skillId, skillId));
}

export async function addSkillTool(ctx: TenantContext, skillId: string, toolId: string) {
  await ctx.db.insert(builtSkillTools).values({ id: newId(), skillId, toolId });
}

export async function removeSkillTool(ctx: TenantContext, skillId: string, toolId: string) {
  await ctx.db
    .delete(builtSkillTools)
    .where(and(eq(builtSkillTools.skillId, skillId), eq(builtSkillTools.toolId, toolId)));
}

// ── Chapters ─────────────────────────────────────────────────────────

export async function getChapters(ctx: TenantContext, skillId: string) {
  return ctx.db
    .select()
    .from(builtChapters)
    .where(eq(builtChapters.skillId, skillId));
}

export async function createChapter(ctx: TenantContext, skillId: string, data: { name: string; type?: string; conditionText?: string; positionX?: number; positionY?: number }) {
  const now = nowMs();
  const id = newId();
  await ctx.db.insert(builtChapters).values({
    id,
    skillId,
    name: data.name,
    type: (data.type as 'chapter' | 'condition') ?? 'chapter',
    conditionText: data.conditionText ?? '',
    positionX: data.positionX ?? 0,
    positionY: data.positionY ?? 0,
    createdAt: now,
    updatedAt: now,
  });
  return { id };
}

export async function updateChapter(ctx: TenantContext, chapterId: string, data: Partial<{ name: string; description: string; guide: string; context: string; outputDef: string; conditionText: string; positionX: number; positionY: number }>) {
  await ctx.db
    .update(builtChapters)
    .set({ ...data, updatedAt: nowMs() })
    .where(eq(builtChapters.id, chapterId));
}

export async function deleteChapter(ctx: TenantContext, chapterId: string) {
  await ctx.db.delete(builtChapters).where(eq(builtChapters.id, chapterId));
}

// ── Chapter Edges ────────────────────────────────────────────────────

export async function getChapterEdges(ctx: TenantContext, skillId: string) {
  return ctx.db
    .select()
    .from(builtChapterEdges)
    .where(eq(builtChapterEdges.skillId, skillId));
}

export async function createChapterEdge(ctx: TenantContext, skillId: string, sourceChapterId: string, targetChapterId: string, label?: string) {
  const id = newId();
  await ctx.db.insert(builtChapterEdges).values({ id, skillId, sourceChapterId, targetChapterId, label: label ?? null });
  return { id };
}

export async function deleteChapterEdge(ctx: TenantContext, edgeId: string) {
  await ctx.db.delete(builtChapterEdges).where(eq(builtChapterEdges.id, edgeId));
}

// ── Chapter Tools ────────────────────────────────────────────────────

export async function getChapterTools(ctx: TenantContext, chapterId: string) {
  return ctx.db
    .select()
    .from(builtChapterTools)
    .where(eq(builtChapterTools.chapterId, chapterId));
}

export async function setChapterTools(ctx: TenantContext, chapterId: string, toolIds: string[]) {
  await ctx.db.delete(builtChapterTools).where(eq(builtChapterTools.chapterId, chapterId));
  for (const toolId of toolIds) {
    await ctx.db.insert(builtChapterTools).values({ id: newId(), chapterId, toolId });
  }
}

// ── Built Agents ─────────────────────────────────────────────────────

export async function listBuiltAgents(ctx: TenantContext) {
  return ctx.db
    .select()
    .from(builtAgents)
    .where(eq(builtAgents.tenantId, ctx.tenantId))
    .orderBy(desc(builtAgents.updatedAt));
}

export async function createBuiltAgent(ctx: TenantContext, input: { name: string; emoji?: string; description?: string; model?: string; systemPrompt?: string; serverId?: string }) {
  const now = nowMs();
  const id = newId();
  await ctx.db.insert(builtAgents).values({
    id,
    name: input.name,
    emoji: input.emoji ?? '🤖',
    description: input.description ?? '',
    model: input.model ?? null,
    systemPrompt: input.systemPrompt ?? '',
    status: 'draft',
    serverId: input.serverId ?? null,
    tenantId: ctx.tenantId,
    createdAt: now,
    updatedAt: now,
  });
  return { id };
}

// ── Built Tools ──────────────────────────────────────────────────────

export async function listBuiltTools(ctx: TenantContext) {
  return ctx.db
    .select()
    .from(builtTools)
    .where(eq(builtTools.tenantId, ctx.tenantId))
    .orderBy(desc(builtTools.updatedAt));
}

export async function getBuiltTool(ctx: TenantContext, toolId: string) {
  const rows = await ctx.db
    .select()
    .from(builtTools)
    .where(and(eq(builtTools.id, toolId), eq(builtTools.tenantId, ctx.tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateBuiltTool(ctx: TenantContext, toolId: string, data: Partial<{ name: string; description: string; scriptCode: string; scriptLang: 'javascript' | 'python' | 'bash'; envVars: string; validationRules: string; executionConfig: string }>) {
  await ctx.db
    .update(builtTools)
    .set({ ...data, updatedAt: nowMs() })
    .where(and(eq(builtTools.id, toolId), eq(builtTools.tenantId, ctx.tenantId)));
}

export async function deleteBuiltTool(ctx: TenantContext, toolId: string) {
  await ctx.db
    .delete(builtTools)
    .where(and(eq(builtTools.id, toolId), eq(builtTools.tenantId, ctx.tenantId)));
}

export async function publishBuiltTool(ctx: TenantContext, toolId: string) {
  const now = nowMs();
  await ctx.db
    .update(builtTools)
    .set({ status: 'published', publishedAt: now, updatedAt: now })
    .where(and(eq(builtTools.id, toolId), eq(builtTools.tenantId, ctx.tenantId)));
}
