/**
 * Remote functions for the agent/skill/tool builder list + create flows
 * (consumed by `$lib/state/builder/builder.svelte.ts`). Mirrors the
 * `/api/builder/{skills,agents,tools}` GET/POST routes, which use the
 * auto-provisioning tenant context.
 *
 * The builder detail routes (`/api/builder/agents/[id]`, the skill editor's
 * chapter/tool endpoints) carry inline action-dispatch DB logic and are a
 * separate follow-up; they stay as `+server.ts` for now.
 */
import { query, command } from '$app/server';
import { eq, desc } from 'drizzle-orm';
import { z } from 'zod';
import { currentOrCreateCtx } from '$server/remote/guard';
import { builtTools } from '@minion-stack/db/schema';
import { newId, nowMs } from '$server/db/utils';
import {
  listBuiltSkills,
  createBuiltSkill,
  listBuiltAgents,
  createBuiltAgent,
} from '$server/services/builder.service';

/** All built skills for the tenant. */
export const getBuiltSkills = query(async () => {
  const ctx = await currentOrCreateCtx();
  return listBuiltSkills(ctx);
});

/** All built agents for the tenant. */
export const getBuiltAgents = query(async () => {
  const ctx = await currentOrCreateCtx();
  return listBuiltAgents(ctx);
});

/** All built tools for the tenant. */
export const getBuiltTools = query(async () => {
  const ctx = await currentOrCreateCtx();
  return ctx.db
    .select()
    .from(builtTools)
    .where(eq(builtTools.tenantId, ctx.tenantId))
    .orderBy(desc(builtTools.updatedAt));
});

/** Create a draft skill. Returns its id. */
export const createSkill = command(
  z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    emoji: z.string().optional(),
    serverId: z.string().optional(),
    maxCycles: z.number().optional(),
  }),
  async (input) => {
    const ctx = await currentOrCreateCtx();
    return createBuiltSkill(ctx, input);
  },
);

/** Create a draft agent. Returns its id. */
export const createAgent = command(
  z.object({
    name: z.string().min(1),
    emoji: z.string().optional(),
    description: z.string().optional(),
    model: z.string().optional(),
    systemPrompt: z.string().optional(),
    serverId: z.string().optional(),
  }),
  async (input) => {
    const ctx = await currentOrCreateCtx();
    return createBuiltAgent(ctx, input);
  },
);

/** Create a draft tool. Returns its id. */
export const createTool = command(
  z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    scriptCode: z.string().optional(),
    scriptLang: z.enum(['bash', 'javascript', 'python']).optional(),
  }),
  async (body) => {
    const ctx = await currentOrCreateCtx();
    const now = nowMs();
    const id = newId();
    await ctx.db.insert(builtTools).values({
      id,
      name: body.name ?? 'Untitled Tool',
      description: body.description ?? '',
      scriptCode: body.scriptCode ?? '// Write your tool script here\n',
      scriptLang: body.scriptLang ?? 'javascript',
      status: 'draft',
      tenantId: ctx.tenantId,
      createdAt: now,
      updatedAt: now,
    });
    return { id };
  },
);
