import { describe, it, expect } from 'vitest';
import { planReconcile, type ReconcileInput } from './reconcile-plan';

const baseInput = (over: Partial<ReconcileInput>): ReconcileInput => ({
  existingGroups: [],
  ungroupedFlows: [],
  installedKeys: [],
  plugins: [],
  ...over,
});

const plugin = (id: string, enabled: boolean, templateIds: string[]) => ({
  pluginId: id,
  displayName: id.toUpperCase(),
  enabled,
  templates: templateIds.map((tid) => ({ id: tid, name: `${id}-${tid}`, nodes: [{ id: 'n' }], edges: [] })),
});

describe('planReconcile', () => {
  it('creates a group for a new flow-contributing plugin', () => {
    const p = planReconcile(baseInput({ plugins: [plugin('alert-watcher', true, [])] }));
    expect(p.groupsToCreate).toHaveLength(1);
    expect(p.groupsToCreate[0]).toMatchObject({ pluginId: 'alert-watcher', name: 'ALERT-WATCHER', disabled: false });
  });

  it('seeds one instance per template only for unseen keys when enabled', () => {
    const p = planReconcile(baseInput({
      plugins: [plugin('aw', true, ['pipeline', 'pipeline-telegram'])],
      installedKeys: ['aw:pipeline'],
    }));
    expect(p.flowsToSeed.map((f) => f.templateId)).toEqual(['pipeline-telegram']);
    expect(p.keysToAdd).toContain('aw:pipeline-telegram');
    expect(p.flowsToSeed[0]).toMatchObject({ pluginId: 'aw', templateId: 'pipeline-telegram' });
  });

  it('does NOT seed when the plugin is disabled', () => {
    const p = planReconcile(baseInput({ plugins: [plugin('aw', false, ['pipeline'])] }));
    expect(p.flowsToSeed).toHaveLength(0);
    expect(p.groupsToCreate[0].disabled).toBe(true);
  });

  it('updates an existing group when disabled-state or name changed', () => {
    const p = planReconcile(baseInput({
      existingGroups: [{ id: 'grp1', name: 'OLD', pluginId: 'aw', disabled: false, createdAt: 0 }],
      plugins: [plugin('aw', false, [])],
    }));
    expect(p.groupsToCreate).toHaveLength(0);
    expect(p.groupsToUpdate).toContainEqual({ id: 'grp1', name: 'AW', disabled: true });
  });

  it('reassigns ungrouped plugin flows into an EXISTING group (migration sweep)', () => {
    const p = planReconcile(baseInput({
      existingGroups: [{ id: 'grp1', name: 'AW', pluginId: 'aw', disabled: false, createdAt: 0 }],
      ungroupedFlows: [{ id: 'f1', pluginId: 'aw' }, { id: 'f2', pluginId: null }],
      plugins: [plugin('aw', true, [])],
    }));
    expect(p.flowsToReassign).toEqual([{ flowId: 'f1', groupRef: 'grp1' }]);
  });

  it('reassigns ungrouped plugin flows into a NEWLY-CREATED group (first-run migration)', () => {
    const p = planReconcile(baseInput({
      existingGroups: [],
      ungroupedFlows: [{ id: 'f1', pluginId: 'aw' }],
      plugins: [plugin('aw', true, [])],
    }));
    expect(p.groupsToCreate[0].tempKey).toBe('new:aw');
    expect(p.flowsToReassign).toEqual([{ flowId: 'f1', groupRef: 'new:aw' }]);
  });

  it('releases a group whose plugin is no longer installed', () => {
    const p = planReconcile(baseInput({
      existingGroups: [{ id: 'grp1', name: 'GONE', pluginId: 'gone', disabled: false, createdAt: 0 }],
      plugins: [],
    }));
    expect(p.groupsToRelease).toEqual(['grp1']);
  });

  it('is a no-op when everything already reconciled', () => {
    const p = planReconcile(baseInput({
      existingGroups: [{ id: 'grp1', name: 'AW', pluginId: 'aw', disabled: false, createdAt: 0 }],
      installedKeys: ['aw:pipeline'],
      plugins: [plugin('aw', true, ['pipeline'])],
    }));
    expect(p.groupsToCreate).toHaveLength(0);
    expect(p.groupsToUpdate).toHaveLength(0);
    expect(p.flowsToSeed).toHaveLength(0);
    expect(p.flowsToReassign).toHaveLength(0);
    expect(p.groupsToRelease).toHaveLength(0);
  });
});
