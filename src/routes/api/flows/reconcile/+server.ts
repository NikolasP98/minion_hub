import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { flows, flowGroups } from '$server/db/pg-schema/flows';
import { and, eq, isNull, or } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { requireAuth } from '$server/auth/authorize';
import { getFlowsCtx } from '$server/auth/flows-ctx';
import { getTenantCtx } from '$server/auth/tenant-ctx';
import { getUserPreferences, upsertUserPreference } from '$server/services/user-preferences.service';
import { planReconcile, type ReconcilePlugin, type ExistingGroup, type UngroupedFlow } from '$lib/flows/reconcile-plan';
import { flowSourceFrom } from '$lib/flows/plugin-source';

const PREF_SECTION = 'pluginFlowInstalls';

export const POST: RequestHandler = async ({ locals, request }) => {
  const user = requireAuth(locals);
  // Flows/groups AND plugin-install bookkeeping (user_preferences) now both live
  // in Supabase Postgres (fctx.db = getCoreDb). user_preferences is keyed by
  // profile_id (Supabase auth uuid = user.supabaseId), not the legacy user id.
  const fctx = await getFlowsCtx(locals);
  const tctx = await getTenantCtx(locals);
  if (!fctx || !tctx) throw error(401);
  const profileId = user.supabaseId;

  const { plugins: incoming } = (await request.json()) as { plugins?: ReconcilePlugin[] };
  const plugins = Array.isArray(incoming) ? incoming : [];

  // Org-scoped: reconcile against the whole org's groups/flows so plugin
  // automations are shared, not duplicated per member.
  const orgGroupFilter = or(eq(flowGroups.tenantId, fctx.tenantId), isNull(flowGroups.tenantId));
  const groupRows = await fctx.db.select().from(flowGroups).where(orgGroupFilter);
  const existingGroups: ExistingGroup[] = groupRows.map((g) => ({
    id: g.id, name: g.name, pluginId: g.pluginId, disabled: g.disabled, createdAt: g.createdAt,
  }));

  // Ungrouped flows (group_id null) in this org — for the migration sweep.
  const flowRows = await fctx.db
    .select()
    .from(flows)
    .where(
      and(
        isNull(flows.groupId),
        or(eq(flows.tenantId, fctx.tenantId), isNull(flows.tenantId)),
      ),
    );
  const ungroupedFlows: UngroupedFlow[] = flowRows.map((f) => ({
    id: f.id, pluginId: flowSourceFrom(f.config)?.pluginId ?? null,
  }));

  const prefs = profileId ? await getUserPreferences(fctx.db, profileId) : {};
  const recorded = prefs[PREF_SECTION] as { keys?: string[] } | undefined;
  const installedKeys = Array.isArray(recorded?.keys) ? recorded!.keys! : [];

  const plan = planReconcile({ existingGroups, ungroupedFlows, installedKeys, plugins });

  const now = Date.now();
  // Resolve group tempKeys → real ids as we create them.
  const tempIdToReal = new Map<string, string>();

  for (const g of plan.groupsToCreate) {
    const id = randomUUID();
    tempIdToReal.set(g.tempKey, id);
    await fctx.db.insert(flowGroups).values({
      id, name: g.name, userId: user.id, tenantId: fctx.tenantId,
      pluginId: g.pluginId, disabled: g.disabled, createdAt: now, updatedAt: now,
    });
  }
  for (const g of plan.groupsToUpdate) {
    await fctx.db.update(flowGroups).set({ name: g.name, disabled: g.disabled, updatedAt: now }).where(eq(flowGroups.id, g.id));
  }
  for (const r of plan.flowsToReassign) {
    const groupId = tempIdToReal.get(r.groupRef) ?? r.groupRef;
    await fctx.db.update(flows).set({ groupId, updatedAt: now }).where(eq(flows.id, r.flowId));
  }
  for (const s of plan.flowsToSeed) {
    const groupId = tempIdToReal.get(s.groupRef) ?? s.groupRef;
    await fctx.db.insert(flows).values({
      id: randomUUID(), name: s.name,
      nodes: JSON.stringify(s.nodes), edges: JSON.stringify(s.edges),
      userId: user.id, tenantId: fctx.tenantId, createdAt: now, updatedAt: now,
      active: false, groupId,
      config: JSON.stringify({ source: { pluginId: s.pluginId, templateId: s.templateId } }),
    });
  }
  for (const gid of plan.groupsToRelease) {
    await fctx.db.update(flowGroups).set({ pluginId: null, disabled: false, updatedAt: now }).where(eq(flowGroups.id, gid));
  }
  if (plan.keysToAdd.length > 0 && profileId) {
    await upsertUserPreference(fctx.db, profileId, PREF_SECTION, { keys: [...installedKeys, ...plan.keysToAdd] });
  }

  return json({
    groupsCreated: plan.groupsToCreate.length,
    groupsUpdated: plan.groupsToUpdate.length,
    flowsSeeded: plan.flowsToSeed.length,
    flowsReassigned: plan.flowsToReassign.length,
    groupsReleased: plan.groupsToRelease.length,
  });
};
