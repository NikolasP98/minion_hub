import { describe, expect, it, vi } from 'vitest';
import { utilityLinks, hasVisibleSectionItems } from './utility-links';
import type { Section } from './sections';
vi.mock('$lib/paraglide/messages', () => ({
  nav_reliability: () => 'Reliability',
  nav_marketplace: () => 'Marketplace',
  nav_cloud: () => 'Cloud',
  nav_killSwitches: () => 'Killswitches',
}));

describe('shared navigation offer policy', () => {
  it('keeps the established desktop utility order for both renderers', () => {
    expect(utilityLinks(() => true).map((item) => item.href)).toEqual([
      '/reliability',
      '/marketplace',
      '/cloud',
      '/killswitches',
    ]);
  });
  it('does not offer denied utilities or mutate the policy decision', () => {
    const permits = new Set(['/marketplace', '/cloud']);
    expect(utilityLinks((href) => permits.has(href)).map((item) => item.href)).toEqual([
      '/marketplace',
      '/cloud',
    ]);
    expect(utilityLinks(() => false)).toEqual([]);
  });
  const group: Section = {
    id: 'agents',
    label: 'Agents',
    tone: 'accent',
    items: [],
    subsections: [
      {
        id: 'private',
        label: 'Private',
        items: [{ href: '/denied', label: 'Denied', icon: 'test', matcher: () => false }],
      },
    ],
  };
  it('hides empty or fully denied subsection headings', () => {
    expect(hasVisibleSectionItems(group, () => false)).toBe(false);
    expect(hasVisibleSectionItems({ ...group, subsections: [] }, () => true)).toBe(false);
  });
  it('keeps headings for an actually permitted nested item', () => {
    expect(hasVisibleSectionItems(group, (href) => href === '/denied')).toBe(true);
  });
});
