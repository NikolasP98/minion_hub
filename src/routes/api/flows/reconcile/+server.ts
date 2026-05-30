import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { flows, flowGroups } from '$server/db/schema';
import { and, eq, isNull, or } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { requireAuth } from '$server/auth/authorize';
import { getTenantCtx } from '$server/auth/tenant-ctx';
import { getUserPreferences, upsertUserPreference } from '$server/services/user-preferences.service';
import { planReconcile, type ReconcilePlugin, type ExistingGroup, type UngroupedFlow } from '$lib/flows/reconcile-plan';
import { flowSourceFrom } from '$lib/flows/plugin-source';

const PREF_SECTION = 'pluginFlowInstalls';

export const POST: RequestHandler = async ({ locals, request }) => {
  const user = requireAuth(locals);
  const ctx = await getTenantCtx(locals);
  if (!ctx) throw error(401);

  const { plugins: incoming } = (await request.json()) as { plugins?: ReconcilePlugin[] };
  const plugins = Array.isArray(incoming) ? incoming : [];

  const ownerFilter = and(
    or(eq(flowGroups.userId, user.id), isNull(flowGroups.userId)),
    or(eq(flowGroups.tenantId, ctx.tenantId), isNull(flowGroups.tenantId)),
  );
  const groupRows = await ctx.db.select().from(flowGroups).where(ownerFilter);
  const existingGroups: ExistingGroup[] = groupRows.map((g) => ({
    id: g.id, name: g.name, pluginId: g.pluginId, disabled: g.disabled, createdAt: g.createdAt,
  }));

  // Ungrouped flows (group_id null) owned by this user — for the migration sweep.
  const flowRows = await ctx.db
    .select()
    .from(flows)
    .where(
      and(
        isNull(flows.groupId),
        or(eq(flows.userId, user.id), isNull(flows.userId)),
        or(eq(flows.tenantId, ctx.tenantId), isNull(flows.tenantId)),
      ),
    );
  const ungroupedFlows: UngroupedFlow[] = flowRows.map((f) => ({
    id: f.id, pluginId: flowSourceFrom(f.config)?.pluginId ?? null,
  }));

  const prefs = await getUserPreferences(ctx.db, user.id);
  const recorded = prefs[PREF_SECTION] as { keys?: string[] } | undefined;
  const installedKeys = Array.isArray(recorded?.keys) ? recorded!.keys! : [];

  const plan = planReconcile({ existingGroups, ungroupedFlows, installedKeys, plugins });

  const now = Date.now();
  // Resolve group tempKeys → real ids as we create them.
  const tempIdToReal = new Map<string, string>();

  for (const g of plan.groupsToCreate) {
    const id = randomUUID();
    tempIdToReal.set(g.tempKey, id);
    await ctx.db.insert(flowGroups).values({
      id, name: g.name, userId: user.id, tenantId: ctx.tenantId,
      pluginId: g.pluginId, disabled: g.disabled, createdAt: now, updatedAt: now,
    });
  }
  for (const g of plan.groupsToUpdate) {
    await ctx.db.update(flowGroups).set({ name: g.name, disabled: g.disabled, updatedAt: now }).where(eq(flowGroups.id, g.id));
  }
  for (const r of plan.flowsToReassign) {
    const groupId = tempIdToReal.get(r.groupRef) ?? r.groupRef;
    await ctx.db.update(flows).set({ groupId, updatedAt: now }).where(eq(flows.id, r.flowId));
  }
  for (const s of plan.flowsToSeed) {
    const groupId = tempIdToReal.get(s.groupRef) ?? s.groupRef;
    await ctx.db.insert(flows).values({
      id: randomUUID(), name: s.name,
      nodes: JSON.stringify(s.nodes), edges: JSON.stringify(s.edges),
      userId: user.id, tenantId: ctx.tenantId, createdAt: now, updatedAt: now,
      active: false, groupId,
      config: JSON.stringify({ source: { pluginId: s.pluginId, templateId: s.templateId } }),
    });
  }
  for (const gid of plan.groupsToRelease) {
    await ctx.db.update(flowGroups).set({ pluginId: null, disabled: false, updatedAt: now }).where(eq(flowGroups.id, gid));
  }
  if (plan.keysToAdd.length > 0) {
    await upsertUserPreference(ctx.db, user.id, PREF_SECTION, { keys: [...installedKeys, ...plan.keysToAdd] });
  }

  return json({
    groupsCreated: plan.groupsToCreate.length,
    groupsUpdated: plan.groupsToUpdate.length,
    flowsSeeded: plan.flowsToSeed.length,
    flowsReassigned: plan.flowsToReassign.length,
    groupsReleased: plan.groupsToRelease.length,
  });
};
