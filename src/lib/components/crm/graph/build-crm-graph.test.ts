import { describe, it, expect } from 'vitest';
import { buildCrmGraph, relationshipCategoryColor, CRM_RADII } from './build-crm-graph';
import type { ContactGraphRow } from '$server/services/crm-contacts.service';
import { chartColors } from '$lib/utils/chart-colors';

const row = (over: Partial<ContactGraphRow> = {}): ContactGraphRow => ({
  contactId: 'c1',
  label: 'Renzo',
  messageCount: 10,
  lastAt: '2026-07-20T00:00:00Z',
  relationship: null,
  ...over,
});

const dist = (n: { ax: number; ay: number }) => Math.hypot(n.ax, n.ay);

describe('buildCrmGraph', () => {
  it('places the org node at the origin, pinned', () => {
    const { nodes } = buildCrmGraph({ org: { id: 'org', name: 'FACES' }, rows: [row()] });
    const org = nodes.find((n) => n.kind === 'org')!;
    expect(org.ax).toBe(0);
    expect(org.ay).toBe(0);
    expect(org.pinned).toBe(true);
  });

  it('anchors contact nodes on their own ring', () => {
    const { nodes } = buildCrmGraph({ org: { id: 'org', name: 'FACES' }, rows: [row()] });
    expect(dist(nodes.find((n) => n.kind === 'contact')!)).toBeCloseTo(CRM_RADII.contact, 5);
  });

  it('emits exactly one node per contact — no channel nodes', () => {
    const { nodes } = buildCrmGraph({
      org: { id: 'org', name: 'FACES' },
      rows: [row({ contactId: 'c1' }), row({ contactId: 'c2', label: 'Other' })],
    });
    expect(nodes.filter((n) => n.kind === 'contact')).toHaveLength(2);
    expect(nodes.some((n) => (n.kind as string) === 'channel')).toBe(false);
  });

  it('never emits contact-contact or party edges — only center→contact', () => {
    const { edges } = buildCrmGraph({
      org: { id: 'org', name: 'FACES' },
      rows: [row({ contactId: 'c1' }), row({ contactId: 'c2', label: 'Other' })],
    });
    for (const e of edges) {
      expect(e.source).toBe('org');
      expect(e.target.startsWith('contact:')).toBe(true);
    }
  });

  it('center-contact edge width follows 1 + min(5, ln(1+messageCount))', () => {
    const { edges } = buildCrmGraph({
      org: { id: 'org', name: 'FACES' },
      rows: [row({ messageCount: 99 })],
    });
    const centerEdge = edges.find((e) => e.source === 'org')!;
    expect(centerEdge.width).toBeCloseTo(1 + Math.min(5, Math.log(1 + 99)), 5);
  });

  it('colors the edge by relationship category; unset/unknown is neutral', () => {
    const colors = chartColors();
    const { edges } = buildCrmGraph({
      org: { id: 'org', name: 'FACES' },
      rows: [row({ relationship: { label: 'mamá', category: 'family', source: 'ai' } })],
    });
    expect(edges[0].color).toBe(colors.emerald);
    expect(relationshipCategoryColor(null)).toBe(colors.muted);
    expect(relationshipCategoryColor('unknown')).toBe(colors.muted);
  });
});
