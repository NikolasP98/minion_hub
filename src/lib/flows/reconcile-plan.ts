/** Pure reconcile planner — no DB. The endpoint executes the returned plan. */

export type ReconcilePlugin = {
  pluginId: string;
  displayName: string;
  enabled: boolean;
  templates: Array<{ id: string; name: string; nodes: unknown[]; edges: unknown[] }>;
};

export type ExistingGroup = {
  id: string;
  name: string;
  pluginId: string | null;
  disabled: boolean;
  createdAt: number;
};

/** An ungrouped flow with its resolved owning-plugin id (from config.source). */
export type UngroupedFlow = { id: string; pluginId: string | null };

export type ReconcileInput = {
  existingGroups: ExistingGroup[];
  ungroupedFlows: UngroupedFlow[];
  installedKeys: string[];
  plugins: ReconcilePlugin[];
};

export type GroupToCreate = { tempKey: string; name: string; pluginId: string; disabled: boolean };
export type GroupToUpdate = { id: string; name: string; disabled: boolean };
export type FlowToSeed = {
  pluginId: string;
  templateId: string;
  name: string;
  nodes: unknown[];
  edges: unknown[];
  /** Existing group id, or the tempKey of a group in groupsToCreate. */
  groupRef: string;
};
export type FlowToReassign = {
  flowId: string;
  /** Existing group id, or the tempKey of a group in groupsToCreate. */
  groupRef: string;
};

export type ReconcilePlan = {
  groupsToCreate: GroupToCreate[];
  groupsToUpdate: GroupToUpdate[];
  flowsToSeed: FlowToSeed[];
  flowsToReassign: FlowToReassign[];
  groupsToRelease: string[]; // group ids → set pluginId=null, disabled=false
  keysToAdd: string[];
};

export function planReconcile(input: ReconcileInput): ReconcilePlan {
  const plan: ReconcilePlan = {
    groupsToCreate: [],
    groupsToUpdate: [],
    flowsToSeed: [],
    flowsToReassign: [],
    groupsToRelease: [],
    keysToAdd: [],
  };
  const installed = new Set(input.installedKeys);
  const pluginIds = new Set(input.plugins.map((p) => p.pluginId));

  for (const p of input.plugins) {
    const existing = input.existingGroups.find((g) => g.pluginId === p.pluginId);
    let groupRef: string;
    if (existing) {
      groupRef = existing.id;
      if (existing.disabled !== !p.enabled || existing.name !== p.displayName) {
        plan.groupsToUpdate.push({ id: existing.id, name: p.displayName, disabled: !p.enabled });
      }
    } else {
      groupRef = `new:${p.pluginId}`;
      plan.groupsToCreate.push({ tempKey: groupRef, name: p.displayName, pluginId: p.pluginId, disabled: !p.enabled });
    }

    // Migration sweep: ungrouped flows belonging to this plugin → into its group.
    // Uses groupRef (existing id OR the to-be-created tempKey) so first-run
    // migration works even when the group is created in the same pass.
    for (const f of input.ungroupedFlows) {
      if (f.pluginId === p.pluginId) {
        plan.flowsToReassign.push({ flowId: f.id, groupRef });
      }
    }

    // Seed unseen templates, only while enabled.
    if (p.enabled) {
      for (const t of p.templates) {
        const key = `${p.pluginId}:${t.id}`;
        if (installed.has(key)) continue;
        installed.add(key);
        plan.keysToAdd.push(key);
        plan.flowsToSeed.push({
          pluginId: p.pluginId,
          templateId: t.id,
          name: t.name,
          nodes: t.nodes,
          edges: t.edges,
          groupRef,
        });
      }
    }
  }

  // Release groups whose plugin is gone (uninstalled).
  for (const g of input.existingGroups) {
    if (g.pluginId && !pluginIds.has(g.pluginId)) {
      plan.groupsToRelease.push(g.id);
    }
  }

  return plan;
}
