import { describe, it, expect } from 'vitest';
import { isPluginGroup, sortGroups, type FlowGroupMeta } from './groups';

const g = (o: Partial<FlowGroupMeta>): FlowGroupMeta => ({
  id: o.id ?? 'x', name: o.name ?? 'X', pluginId: o.pluginId ?? null,
  disabled: o.disabled ?? false, createdAt: o.createdAt ?? 0,
});

describe('isPluginGroup', () => {
  it('true when pluginId set, false otherwise', () => {
    expect(isPluginGroup(g({ pluginId: 'alert-watcher' }))).toBe(true);
    expect(isPluginGroup(g({ pluginId: null }))).toBe(false);
  });
});

describe('sortGroups', () => {
  it('orders user groups before plugin groups, then by createdAt', () => {
    const sorted = sortGroups([
      g({ id: 'p1', pluginId: 'plug', createdAt: 1 }),
      g({ id: 'u2', pluginId: null, createdAt: 5 }),
      g({ id: 'u1', pluginId: null, createdAt: 2 }),
    ]);
    expect(sorted.map((x) => x.id)).toEqual(['u1', 'u2', 'p1']);
  });
});
