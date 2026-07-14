import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { eq, and, asc } from 'drizzle-orm';
import { builtAgents, builtAgentSkills } from '@minion-stack/db/pg';
import { newId } from '$server/db/utils';
import { requireCoreCtx } from '$server/auth/core-ctx';
import {
  requireBuilderCapability,
  requireBuilderGatewayAccess,
  requireBuilderOwnership,
} from '$server/services/builder-access';
import { finalizeBuiltAgentPublish } from '$server/services/builder.service';
import { synchronizeRuntimeAgent } from '$server/services/builder-agent-publisher';
import { getGatewayCredentialsById } from '$server/services/gateway.pg.service';
import { gatewayCallToInstance } from '$lib/server/gateway-rpc';

/** GET /api/builder/agents/:id — agent with skill slots */
export const GET: RequestHandler = async ({ locals, params }) => {
  await requireBuilderCapability(locals, 'view');
  const ctx = await requireCoreCtx(locals);
  await requireBuilderOwnership(locals, ctx, 'agent', params.id!);

  const skillSlots = await ctx.db
    .select()
    .from(builtAgentSkills)
    .where(eq(builtAgentSkills.agentId, params.id!))
    .orderBy(asc(builtAgentSkills.position));

  // Re-fetch to return full agent data
  const [agent] = await ctx.db
    .select()
    .from(builtAgents)
    .where(and(eq(builtAgents.id, params.id!), eq(builtAgents.tenantId, ctx.tenantId)))
    .limit(1);

  return json({ agent, skillSlots });
};

/** PUT /api/builder/agents/:id — update agent or manage skill slots */
export const PUT: RequestHandler = async ({ locals, params, request }) => {
  await requireBuilderCapability(locals, 'edit');
  const ctx = await requireCoreCtx(locals);
  await requireBuilderOwnership(locals, ctx, 'agent', params.id!);

  const body = await request.json();
  const { action } = body;

  if (action === 'publish') {
    const [draft] = await ctx.db
      .select()
      .from(builtAgents)
      .where(and(eq(builtAgents.id, params.id!), eq(builtAgents.tenantId, ctx.tenantId)))
      .limit(1);
    if (!draft?.gatewayId) throw error(409, 'Choose a gateway before publishing this agent.');
    await requireBuilderGatewayAccess(locals, draft.gatewayId);
    const credentials = await getGatewayCredentialsById(draft.gatewayId);
    if (!credentials) throw error(503, 'The selected gateway is unavailable.');
    try {
      const result = await synchronizeRuntimeAgent(
        {
          id: draft.id,
          tenantId: ctx.tenantId,
          name: draft.name,
          emoji: draft.emoji,
          model: draft.model,
          systemPrompt: draft.systemPrompt,
          runtimeAgentId: draft.runtimeAgentId,
        },
        (method, rpcParams) => gatewayCallToInstance(credentials.url, credentials.token, method, rpcParams),
      );
      await finalizeBuiltAgentPublish(ctx, draft.id, result.runtimeAgentId, draft.gatewayId);
      return json({ ok: true, runtimeAgentId: result.runtimeAgentId });
    } catch (cause) {
      console.error('[builder] runtime agent publish failed', cause);
      throw error(502, 'The runtime agent could not be synchronized. The draft was not published.');
    }
  }

  if (action === 'add-skill') {
    await requireBuilderOwnership(locals, ctx, 'skill', body.skillId);
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
      updatedAt: new Date(),
    })
    .where(and(eq(builtAgents.id, params.id!), eq(builtAgents.tenantId, ctx.tenantId)));

  return json({ ok: true });
};

/** DELETE /api/builder/agents/:id */
export const DELETE: RequestHandler = async ({ locals, params }) => {
  await requireBuilderCapability(locals, 'delete');
  const ctx = await requireCoreCtx(locals);
  await requireBuilderOwnership(locals, ctx, 'agent', params.id!);

  await ctx.db
    .delete(builtAgents)
    .where(and(eq(builtAgents.id, params.id!), eq(builtAgents.tenantId, ctx.tenantId)));
  return json({ ok: true });
};
