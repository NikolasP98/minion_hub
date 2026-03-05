import { describe, it, expect } from 'vitest';
import { TABS, TAB_MAPPING, SECURITY_GROUP_IDS, getGroupsForTab } from './config-schema';
import type { ConfigGroup } from '$lib/types/config';

// Helper to create a mock ConfigGroup with a given id and order
function mockGroup(id: string, order: number): ConfigGroup {
  return {
    id,
    label: id.charAt(0).toUpperCase() + id.slice(1),
    order,
    fields: [],
  };
}

// Representative test groups covering all GROUP_ORDER ranges
const ALL_GROUPS: ConfigGroup[] = [
  // Setup (0-39)
  mockGroup('wizard', 20),
  mockGroup('update', 25),
  mockGroup('diagnostics', 27),
  mockGroup('gateway', 30),
  mockGroup('nodeHost', 35),
  // AI (40-79)
  mockGroup('agents', 40),
  mockGroup('tools', 50),
  mockGroup('bindings', 55),
  mockGroup('audio', 60),
  mockGroup('models', 70),
  // Automation (80-129) -- some carved out to security
  mockGroup('messages', 80),
  mockGroup('commands', 85),
  mockGroup('session', 90),
  mockGroup('cron', 100),
  mockGroup('hooks', 110),
  mockGroup('ui', 120),
  // Comms (130-199)
  mockGroup('browser', 130),
  mockGroup('talk', 140),
  mockGroup('channels', 150),
  // Extensions (200-499)
  mockGroup('skills', 200),
  mockGroup('plugins', 205),
  mockGroup('discovery', 210),
  mockGroup('presence', 220),
  mockGroup('voicewake', 230),
  // System (500+)
  mockGroup('logging', 900),
];

describe('TABS constant', () => {
  it('has exactly 6 tabs', () => {
    expect(TABS).toHaveLength(6);
  });

  it('has correct tab IDs in order', () => {
    expect(TABS.map((t) => t.id)).toEqual([
      'ai', 'agents', 'comms', 'security', 'system', 'appearance',
    ]);
  });

  it('each tab has id, label, and icon', () => {
    for (const tab of TABS) {
      expect(tab.id).toBeTruthy();
      expect(tab.label).toBeTruthy();
      expect(tab.icon).toBeTruthy();
    }
  });
});

describe('TAB_MAPPING', () => {
  it('is exported as a constant', () => {
    expect(TAB_MAPPING).toBeDefined();
    expect(typeof TAB_MAPPING).toBe('object');
  });
});

describe('SECURITY_GROUP_IDS', () => {
  it('contains session and commands', () => {
    expect(SECURITY_GROUP_IDS.has('session')).toBe(true);
    expect(SECURITY_GROUP_IDS.has('commands')).toBe(true);
  });
});

describe('getGroupsForTab', () => {
  it('returns AI groups (order 40-79)', () => {
    const result = getGroupsForTab('ai', ALL_GROUPS);
    const ids = result.map((g) => g.id);
    expect(ids).toEqual(['agents', 'tools', 'bindings', 'audio', 'models']);
  });

  it('returns Agents groups from automation meta-group minus security carve-outs', () => {
    const result = getGroupsForTab('agents', ALL_GROUPS);
    const ids = result.map((g) => g.id);
    // messages, cron, hooks, ui -- but NOT commands or session (security carve-outs)
    expect(ids).toContain('messages');
    expect(ids).toContain('cron');
    expect(ids).toContain('hooks');
    expect(ids).toContain('ui');
    expect(ids).not.toContain('commands');
    expect(ids).not.toContain('session');
  });

  it('returns Comms groups (order 130-199)', () => {
    const result = getGroupsForTab('comms', ALL_GROUPS);
    const ids = result.map((g) => g.id);
    expect(ids).toEqual(['browser', 'talk', 'channels']);
  });

  it('returns Security groups (carved out from other meta-groups)', () => {
    const result = getGroupsForTab('security', ALL_GROUPS);
    const ids = result.map((g) => g.id);
    expect(ids).toContain('session');
    expect(ids).toContain('commands');
  });

  it('returns System groups (setup + extensions + system meta-groups) minus security carve-outs', () => {
    const result = getGroupsForTab('system', ALL_GROUPS);
    const ids = result.map((g) => g.id);
    // Setup groups
    expect(ids).toContain('wizard');
    expect(ids).toContain('update');
    expect(ids).toContain('gateway');
    // Extensions groups
    expect(ids).toContain('skills');
    expect(ids).toContain('plugins');
    // System groups
    expect(ids).toContain('logging');
  });

  it('returns empty array for appearance tab', () => {
    const result = getGroupsForTab('appearance', ALL_GROUPS);
    expect(result).toEqual([]);
  });

  it('returns results sorted by group order', () => {
    const result = getGroupsForTab('system', ALL_GROUPS);
    const orders = result.map((g) => g.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it('every GROUP_ORDER key appears in exactly one tab', () => {
    const allTabIds = TABS.map((t) => t.id);
    const groupIdToTab = new Map<string, string>();

    for (const tabId of allTabIds) {
      const tabGroups = getGroupsForTab(tabId, ALL_GROUPS);
      for (const g of tabGroups) {
        expect(groupIdToTab.has(g.id)).toBe(false); // no duplicates
        groupIdToTab.set(g.id, tabId);
      }
    }

    // Every group in ALL_GROUPS should be accounted for
    for (const g of ALL_GROUPS) {
      expect(groupIdToTab.has(g.id)).toBe(true);
    }
  });

  it('returns empty array for unknown tab ID', () => {
    const result = getGroupsForTab('nonexistent', ALL_GROUPS);
    expect(result).toEqual([]);
  });
});
