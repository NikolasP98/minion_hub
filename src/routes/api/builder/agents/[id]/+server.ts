import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { eq, and, asc } from 'drizzle-orm';
import { builtAgents, builtAgentSkills } from '$server/db/schema';
import { newId, nowMs } from '$server/db/utils';
import { getOrCreateTenantCtx } from '$server/auth/tenant-ctx';
import { requireAuth } from '$server/auth/authorize';
import type { TenantContext } from '$server/services/base';

/**
 * Fetch a built agent and verify the requesting user owns it (or is an admin).
 * Throws 404 if not found in tenant, 403 if found but not owned.
 */
async function requireAgentOwnership(
  userId: string,
  isAdmin: boolean,
  agentId: string,
  tenantId: string,
  ctx: TenantContext,
) {
  const [agent] = await ctx.db
    .select()
    .from(builtAgents)
    .where(and(eq(builtAgents.id, agentId), eq(builtAgents.tenantId, tenantId)))
    .limit(1);

  if (!agent) throw error(404, 'Agent not found');

  if (!isAdmin && agent.createdBy !== userId) throw error(403, 'Forbidden');

  return agent;
}

/** GET /api/builder/agents/:id — agent with skill slots */
export const GET: RequestHandler = async ({ locals, params }) => {
  const user = requireAuth(locals);
  const ctx = await getOrCreateTenantCtx(locals);

  await requireAgentOwnership(user.id, user.role === 'admin', params.id!, ctx.tenantId, ctx);

  const skillSlots = await ctx.db
    .select()
    .from(builtAgentSkills)
    .where(eq(builtAgentSkills.agentId, params.id!))
    .orderBy(asc(builtAgentSkills.position));

  // Re-fetch to return full agent data
  const [agent] = await ctx.db
    .select()
    .from(builtAgents)
    .where(eq(builtAgents.id, params.id!))
    .limit(1);

  return json({ agent, skillSlots });
};

/** PUT /api/builder/agents/:id — update agent or manage skill slots */
export const PUT: RequestHandler = async ({ locals, params, request }) => {
  const user = requireAuth(locals);
  const ctx = await getOrCreateTenantCtx(locals);

  await requireAgentOwnership(user.id, user.role === 'admin', params.id!, ctx.tenantId, ctx);

  const body = await request.json();
  const { action } = body;

  if (action === 'publish') {
    const now = nowMs();
    await ctx.db
      .update(builtAgents)
      .set({ status: 'published', publishedAt: now, updatedAt: now })
      .where(and(eq(builtAgents.id, params.id!), eq(builtAgents.tenantId, ctx.tenantId)));
    return json({ ok: true });
  }

  if (action === 'add-skill') {
    const maxPos = await ctx.db
      .select({ position: builtAgentSkills.position })
      .from(builtAgentSkills)
      .where(eq(builtAgentSkills.agentId, params.id!))
      .orderBy(asc(builtAgentSkills.position));
    const nextPos = maxPos.length > 0 ? maxPos[maxPos.length - 1].position + 1 : 0;
    await ctx.db.insert(builtAgentSkills).values({
      id: newId(),
      agentId: params.id!,
      skillId: body.skillId,
      position: nextPos,
    });
    return json({ ok: true });
  }

  if (action === 'remove-skill') {
    await ctx.db
      .delete(builtAgentSkills)
      .where(
        and(eq(builtAgentSkills.agentId, params.id!), eq(builtAgentSkills.skillId, body.skillId)),
      );
    return json({ ok: true });
  }

  if (action === 'reorder-skills') {
    const { skillIds } = body as { skillIds: string[] };
    for (let i = 0; i < skillIds.length; i++) {
      await ctx.db
        .update(builtAgentSkills)
        .set({ position: i })
        .where(
          and(eq(builtAgentSkills.agentId, params.id!), eq(builtAgentSkills.skillId, skillIds[i])),
        );
    }
    return json({ ok: true });
  }

  // Default: update agent metadata
  const {
    name,
    emoji,
    description,
    model,
    systemPrompt,
    temperature,
    maxTokens,
    retryPolicy,
    fallbackAgentId,
  } = body;
  await ctx.db
    .update(builtAgents)
    .set({
      ...(name !== undefined && { name }),
      ...(emoji !== undefined && { emoji }),
      ...(description !== undefined && { description }),
      ...(model !== undefined && { model }),
      ...(systemPrompt !== undefined && { systemPrompt }),
      ...(temperature !== undefined && { temperature }),
      ...(maxTokens !== undefined && { maxTokens }),
      ...(retryPolicy !== undefined && { retryPolicy: JSON.stringify(retryPolicy) }),
      ...(fallbackAgentId !== undefined && { fallbackAgentId }),
      updatedAt: nowMs(),
    })
    .where(and(eq(builtAgents.id, params.id!), eq(builtAgents.tenantId, ctx.tenantId)));

  return json({ ok: true });
};

/** DELETE /api/builder/agents/:id */
export const DELETE: RequestHandler = async ({ locals, params }) => {
  const user = requireAuth(locals);
  const ctx = await getOrCreateTenantCtx(locals);

  await requireAgentOwnership(user.id, user.role === 'admin', params.id!, ctx.tenantId, ctx);

  await ctx.db
    .delete(builtAgents)
    .where(and(eq(builtAgents.id, params.id!), eq(builtAgents.tenantId, ctx.tenantId)));
  return json({ ok: true });
};
