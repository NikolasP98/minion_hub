import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { flows, flowGroups } from '$server/db/pg-schema/flows';
import { and, eq, isNull } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { requireAuth } from '$server/auth/authorize';
import { getFlowsCtx } from '$server/auth/flows-ctx';
import { getTenantCtx } from '$server/auth/tenant-ctx';
import { withOrgCore } from '$server/db/with-org-core';
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

  // Plugin-install bookkeeping (user_preferences) is keyed by profile_id, not by
  // org tenant, so it stays on the plain core db outside the org-scoped txn.
  const prefs = profileId ? await getUserPreferences(fctx.db, profileId) : {};
  const recorded = prefs[PREF_SECTION] as { keys?: string[] } | undefined;
  const installedKeys = Array.isArray(recorded?.keys) ? recorded!.keys! : [];

  // Org-shared: read-then-write the whole org's groups/flows in ONE RLS-scoped
  // txn so plugin automations are shared across the org, not duplicated per
  // member. Strictly scoped by org tenant — no null-tenant rows.
  const plan = await withOrgCore(fctx, async (tx) => {
    const groupRows = await tx
      .select()
      .from(flowGroups)
      .where(eq(flowGroups.tenantId, fctx.tenantId));
    const existingGroups: ExistingGroup[] = groupRows.map((g) => ({
      id: g.id, name: g.name, pluginId: g.pluginId, disabled: g.disabled, createdAt: g.createdAt,
    }));

    // Ungrouped flows (group_id null) in this org — for the migration sweep.
    const flowRows = await tx
      .select()
      .from(flows)
      .where(and(isNull(flows.groupId), eq(flows.tenantId, fctx.tenantId)));
    const ungroupedFlows: UngroupedFlow[] = flowRows.map((f) => ({
      id: f.id, pluginId: flowSourceFrom(f.config)?.pluginId ?? null,
    }));

    const reconciled = planReconcile({ existingGroups, ungroupedFlows, installedKeys, plugins });

    const now = Date.now();
    // Resolve group tempKeys → real ids as we create them.
    const tempIdToReal = new Map<string, string>();

    for (const g of reconciled.groupsToCreate) {
      const id = randomUUID();
      tempIdToReal.set(g.tempKey, id);
      await tx.insert(flowGroups).values({
        id, name: g.name, userId: user.id, tenantId: fctx.tenantId,
        pluginId: g.pluginId, disabled: g.disabled, createdAt: now, updatedAt: now,
      });
    }
    for (const g of reconciled.groupsToUpdate) {
      await tx.update(flowGroups).set({ name: g.name, disabled: g.disabled, updatedAt: now }).where(eq(flowGroups.id, g.id));
    }
    for (const r of reconciled.flowsToReassign) {
      const groupId = tempIdToReal.get(r.groupRef) ?? r.groupRef;
      await tx.update(flows).set({ groupId, updatedAt: now }).where(eq(flows.id, r.flowId));
    }
    for (const s of reconciled.flowsToSeed) {
      const groupId = tempIdToReal.get(s.groupRef) ?? s.groupRef;
      await tx.insert(flows).values({
        id: randomUUID(), name: s.name,
        nodes: JSON.stringify(s.nodes), edges: JSON.stringify(s.edges),
        userId: user.id, tenantId: fctx.tenantId, createdAt: now, updatedAt: now,
        active: false, groupId,
        config: JSON.stringify({ source: { pluginId: s.pluginId, templateId: s.templateId } }),
      });
    }
    for (const gid of reconciled.groupsToRelease) {
      await tx.update(flowGroups).set({ pluginId: null, disabled: false, updatedAt: now }).where(eq(flowGroups.id, gid));
    }

    return reconciled;
  });

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
