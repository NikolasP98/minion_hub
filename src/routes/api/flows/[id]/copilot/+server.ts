import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { generateText, tool, stepCountIs } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';
import { env } from '$env/dynamic/private';
import { and, eq } from 'drizzle-orm';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { getCoreDb } from '$server/db/pg-client';
import { withOrgCore } from '$server/db/with-org-core';
import { flows } from '$server/db/pg-schema/flows';
import * as ops from '$lib/flows/flow-ops';
import type { WorkingFlow } from '$lib/flows/flow-ops';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

const SYSTEM = `You edit an automation flow (nodes + edges). Node types: trigger, schedule, agent, llm, router, toolAgent, channel, handoff, reaction, transform, structured, pluginTrigger, pluginAction. Make the SMALLEST change that satisfies the user. Use the provided tools to mutate the flow; reference nodes by id. After editing, call validate. Explain what you changed in one short paragraph.`;

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await requireCoreCtx(locals);
  const body = (await request.json().catch(() => null)) as {
    messages?: { role: 'user' | 'assistant'; content: string }[];
  } | null;
  const messages = body?.messages ?? [];

  const [row] = await withOrgCore({ db: getCoreDb(), tenantId: ctx.tenantId }, (tx) =>
    tx
      .select()
      .from(flows)
      .where(and(eq(flows.id, params.id), eq(flows.tenantId, ctx.tenantId))),
  );
  if (!row) throw error(404, 'flow not found');
  const isAdmin = locals.user?.role === 'admin';
  const isOwner = !!locals.user?.id && row.userId === locals.user.id;
  if (!isAdmin && !isOwner) throw error(403, 'admins or the flow owner only');

  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) throw error(503, 'copilot unavailable: OPENROUTER_API_KEY not set');

  let work: WorkingFlow = { nodes: JSON.parse(row.nodes), edges: JSON.parse(row.edges) };
  const openrouter = createOpenAI({ apiKey, baseURL: OPENROUTER_BASE_URL });

  const tools = {
    addNode: tool({
      description: 'Add a node. Returns the new node id.',
      inputSchema: z.object({ type: z.string(), label: z.string(), data: z.record(z.string(), z.unknown()).optional() }),
      execute: async (a) => {
        const r = ops.addNode(work, a);
        work = r.flow;
        return { nodeId: r.nodeId };
      },
    }),
    connectNodes: tool({
      description: 'Connect source → target.',
      inputSchema: z.object({
        source: z.string(),
        target: z.string(),
        sourceHandle: z.string().optional(),
        targetHandle: z.string().optional(),
      }),
      execute: async (a) => {
        work = ops.connectNodes(work, a);
        return { ok: true };
      },
    }),
    updateNodeConfig: tool({
      description: 'Shallow-merge data into a node.',
      inputSchema: z.object({ nodeId: z.string(), data: z.record(z.string(), z.unknown()) }),
      execute: async (a) => {
        work = ops.updateNodeConfig(work, a);
        return { ok: true };
      },
    }),
    removeNode: tool({
      description: 'Remove a node and its edges.',
      inputSchema: z.object({ nodeId: z.string() }),
      execute: async (a) => {
        work = ops.removeNode(work, a);
        return { ok: true };
      },
    }),
    removeEdge: tool({
      description: 'Remove an edge by id.',
      inputSchema: z.object({ edgeId: z.string() }),
      execute: async (a) => {
        work = ops.removeEdge(work, a);
        return { ok: true };
      },
    }),
    validate: tool({
      description: 'Validate the current flow.',
      inputSchema: z.object({}),
      execute: async () => ops.validateFlow(work),
    }),
  };

  const model = env.FLOW_COPILOT_MODEL || env.ARTIFACT_BUILDER_MODEL || 'anthropic/claude-3.7-sonnet';
  let text: string;
  try {
    const res = await generateText({
      model: openrouter(model),
      system: `${SYSTEM}\n\nCurrent flow:\n${JSON.stringify(work)}`,
      messages,
      tools,
      stopWhen: stepCountIs(8),
    });
    text = res.text;
  } catch (e) {
    throw error(502, `copilot failed: ${(e as Error).message}`);
  }

  return json({ message: text, proposedFlow: work, validation: ops.validateFlow(work) });
};
