import { eq, and, desc, inArray } from 'drizzle-orm';
import { builtSkills, builtSkillTools, builtChapters, builtChapterEdges, builtChapterTools, builtAgents, builtAgentSkills, builtTools, agentBuiltSkills } from '$server/db/schema';
import { newId, nowMs } from '$server/db/utils';
import type { TenantContext } from './base';

// ── Built Skills ──────────────────────────────────────────────────────

export interface CreateSkillInput {
  name: string;
  description?: string;
  emoji?: string;
  serverId?: string;
  maxCycles?: number;
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

export async function listBuiltSkills(ctx: TenantContext, opts?: { status?: 'draft' | 'published' }) {
  const conditions = [eq(builtSkills.tenantId, ctx.tenantId)];
  if (opts?.status) conditions.push(eq(builtSkills.status, opts.status));
  return ctx.db
    .select()
    .from(builtSkills)
    .where(and(...conditions))
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

// ── Publish Validation ────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export async function validateSkillForPublish(ctx: TenantContext, skillId: string): Promise<ValidationResult> {
  const errors: string[] = [];

  const skill = await getBuiltSkill(ctx, skillId);
  if (!skill) return { valid: false, errors: ['Skill not found'] };

  if (!skill.name?.trim()) errors.push('Skill must have a name');

  const chapters = await getChapters(ctx, skillId);
  if (chapters.length === 0) {
    errors.push('Skill must have at least 1 chapter');
    return { valid: false, errors };
  }

  // Chapter-type nodes must have guide text
  const missingGuide = chapters.filter(ch => ch.type === 'chapter' && !ch.guide?.trim());
  if (missingGuide.length > 0) {
    errors.push(`${missingGuide.length} chapter(s) missing instructions: ${missingGuide.map(ch => ch.name).join(', ')}`);
  }

  // Condition-type nodes must have conditionText
  const missingCondition = chapters.filter(ch => ch.type === 'condition' && !ch.conditionText?.trim());
  if (missingCondition.length > 0) {
    errors.push(`${missingCondition.length} condition(s) missing question: ${missingCondition.map(ch => ch.name).join(', ')}`);
  }

  // Chapter-type nodes must have at least 1 tool — single batch query instead of N+1
  const chapterOnlyNodes = chapters.filter(c => c.type === 'chapter');
  if (chapterOnlyNodes.length > 0) {
    const chapterIds = chapterOnlyNodes.map(c => c.id);
    const allTools = await ctx.db
      .select({ chapterId: builtChapterTools.chapterId })
      .from(builtChapterTools)
      .where(inArray(builtChapterTools.chapterId, chapterIds));
    const chaptersWithTools = new Set(allTools.map(t => t.chapterId));
    for (const ch of chapterOnlyNodes) {
      if (!chaptersWithTools.has(ch.id)) {
        errors.push(`Chapter "${ch.name}" has no tools assigned`);
      }
    }
  }

  // Multi-chapter skills must have edges and all nodes reachable via BFS from root nodes
  if (chapters.length > 1) {
    const edges = await getChapterEdges(ctx, skillId);
    if (edges.length === 0) {
      errors.push('Chapters are not connected (no edges defined)');
    } else {
      // BFS from all root nodes (nodes with no incoming edges)
      const hasIncoming = new Set(edges.map(e => e.targetChapterId));
      const roots = chapters.filter(ch => !hasIncoming.has(ch.id));

      if (roots.length > 0) {
        // Build adjacency list and BFS from all roots
        const reachable = new Set<string>(roots.map(r => r.id));
        const queue = [...roots.map(r => r.id)];
        const adjMap = new Map<string, string[]>();
        for (const ch of chapters) adjMap.set(ch.id, []);
        for (const e of edges) adjMap.get(e.sourceChapterId)?.push(e.targetChapterId);

        while (queue.length > 0) {
          const current = queue.shift()!;
          for (const neighbor of adjMap.get(current) ?? []) {
            if (!reachable.has(neighbor)) {
              reachable.add(neighbor);
              queue.push(neighbor);
            }
          }
        }

        const unreachable = chapters.filter(ch => !reachable.has(ch.id));
        if (unreachable.length > 0) {
          errors.push(`${unreachable.length} disconnected chapter(s): ${unreachable.map(ch => ch.name).join(', ')}`);
        }
      }
      // else: roots.length === 0 means all nodes have incoming edges (pure cycle) — valid, skip reachability check
    }
  }

  return { valid: errors.length === 0, errors };
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
  if (toolIds.length > 0) {
    await ctx.db.insert(builtChapterTools).values(
      toolIds.map(toolId => ({ id: newId(), chapterId, toolId }))
    );
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

// ── Agent Built Skills (gateway agent → built skill mapping) ─────────

export async function setAgentBuiltSkills(ctx: TenantContext, gatewayAgentId: string, serverId: string, skillIds: string[]) {
  await ctx.db
    .delete(agentBuiltSkills)
    .where(and(
      eq(agentBuiltSkills.gatewayAgentId, gatewayAgentId),
      eq(agentBuiltSkills.serverId, serverId),
      eq(agentBuiltSkills.tenantId, ctx.tenantId),
    ));
  if (skillIds.length > 0) {
    const now = nowMs();
    await ctx.db.insert(agentBuiltSkills).values(
      skillIds.map((skillId, i) => ({
        id: newId(),
        gatewayAgentId,
        serverId,
        tenantId: ctx.tenantId,
        skillId,
        position: i,
        createdAt: now,
      }))
    );
  }
}
