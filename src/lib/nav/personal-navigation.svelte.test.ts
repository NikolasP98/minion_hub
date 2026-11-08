import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PersonalNavigation } from './personal-navigation';
const { mockPage } = vi.hoisted(() => ({
  mockPage: {
    data: {
      user: { id: 'actor-a', role: 'user' },
      activeOrgId: 'org-a',
      preferences: { preferences: {} as Record<string, unknown> },
    },
  },
}));
vi.mock('$app/state', () => ({ page: mockPage }));
vi.mock('$lib/state/ui/nav-mode.svelte', () => ({ navModuleData: () => ({}) }));
vi.mock('$lib/access/can.svelte', () => ({ canViewPath: () => true }));
vi.mock('./modules', () => ({ visibleModules: () => [] }));
import { personalEditor, personalLayout } from './personal-navigation.svelte';

beforeEach(() => {
  personalEditor.current = null;
  mockPage.data.user.id = 'actor-a';
  mockPage.data.activeOrgId = 'org-a';
  mockPage.data.preferences.preferences = {};
});
describe('personal navigation live editor', () => {
  it('reads the same current value as the mounted editor without a copied snapshot', () => {
    let value: PersonalNavigation = {
      version: 1,
      organizationId: 'org-a',
      hidden: ['pos'],
      order: [],
    };
    personalEditor.current = {
      owner: JSON.stringify(['actor-a', 'org-a']),
      token: Symbol(),
      read: () => value,
    };
    expect(personalLayout().hidden).toEqual(['pos']);
    value = { ...value, hidden: [] };
    expect(personalLayout().hidden).toEqual([]);
    value = { ...value, order: ['stock', 'pos'] };
    expect(personalLayout().order).toEqual(['stock', 'pos']);
  });
  it('never reads another actor or organization editor and returns the corresponding saved layout', () => {
    const read = vi.fn(() => ({
      version: 1 as const,
      organizationId: 'org-a',
      hidden: ['pos'],
      order: [],
    }));
    personalEditor.current = { owner: JSON.stringify(['actor-a', 'org-a']), token: Symbol(), read };
    mockPage.data.activeOrgId = 'org-b';
    mockPage.data.preferences.preferences['personalNavigation:org-b'] = {
      version: 1,
      organizationId: 'org-b',
      hidden: ['stock'],
      order: [],
    };
    expect(personalLayout().hidden).toEqual(['stock']);
    expect(read).not.toHaveBeenCalled();
    mockPage.data.activeOrgId = 'org-a';
    mockPage.data.user.id = 'actor-b';
    expect(personalLayout().hidden).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });
});
