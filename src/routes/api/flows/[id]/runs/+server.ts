import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { flows, flowRuns } from '$server/db/pg-schema/flows';
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { requireAuth } from '$server/auth/authorize';
import { getFlowsCtx, type FlowsCtx } from '$server/auth/flows-ctx';

/** How many runs to keep per flow (older ones are pruned on insert). */
const MAX_RUNS_PER_FLOW = 50;
/** How many runs the history list returns. */
const LIST_LIMIT = 30;

/** Resolve a flow and verify it belongs to the caller's org (mirrors /api/flows/[id]). */
async function requireFlowInOrg(tenantId: string, flowId: string, ctx: FlowsCtx) {
  const [flow] = await ctx.db
    .select()
    .from(flows)
    .where(and(eq(flows.id, flowId), or(eq(flows.tenantId, tenantId), isNull(flows.tenantId))));
  if (!flow) throw error(404, 'Flow not found');
  return flow;
}

/** List recent Test Runs for a flow (newest first), events included for replay. */
export const GET: RequestHandler = async ({ locals, params }) => {
  requireAuth(locals);
  const ctx = await getFlowsCtx(locals);
  if (!ctx) throw error(401);
  await requireFlowInOrg(ctx.tenantId, params.id!, ctx);

  const rows = await ctx.db
    .select()
    .from(flowRuns)
    .where(eq(flowRuns.flowId, params.id!))
    .orderBy(desc(flowRuns.startedAt))
    .limit(LIST_LIMIT);

  const runs = rows.map((r) => ({
    id: r.id,
    startedAt: r.startedAt,
    durationMs: r.durationMs,
    status: r.status,
    source: r.source,
    events: safeParse(r.events),
  }));

  return json({ runs });
};

/** Persist one finished Test Run. */
export const POST: RequestHandler = async ({ locals, params, request }) => {
  const user = requireAuth(locals);
  const ctx = await getFlowsCtx(locals);
  if (!ctx) throw error(401);
  await requireFlowInOrg(ctx.tenantId, params.id!, ctx);

  const body = (await request.json()) as {
    startedAt?: number;
    durationMs?: number;
    status?: string;
    source?: string;
    events?: unknown[];
  };
  if (!Array.isArray(body.events)) throw error(400, 'events[] required');

  const now = Date.now();
  const id = randomUUID();
  await ctx.db.insert(flowRuns).values({
    id,
    flowId: params.id!,
    userId: user.id,
    tenantId: ctx.tenantId,
    startedAt: typeof body.startedAt === 'number' ? body.startedAt : now,
    durationMs: typeof body.durationMs === 'number' ? body.durationMs : 0,
    status: body.status === 'error' ? 'error' : 'completed',
    source: body.source === 'production' ? 'production' : 'test',
    events: JSON.stringify(body.events),
    createdAt: now,
  });

  // Prune older runs beyond the cap for this flow.
  const ids = await ctx.db
    .select({ id: flowRuns.id })
    .from(flowRuns)
    .where(eq(flowRuns.flowId, params.id!))
    .orderBy(desc(flowRuns.startedAt));
  const stale = ids.slice(MAX_RUNS_PER_FLOW).map((r) => r.id);
  if (stale.length > 0) {
    await ctx.db
      .delete(flowRuns)
      .where(and(eq(flowRuns.flowId, params.id!), inArray(flowRuns.id, stale)));
  }

  return json({ ok: true, id });
};

function safeParse(s: string): unknown[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
