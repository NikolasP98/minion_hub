import { describe, expect, it } from 'vitest';
import { allPages, resolvePath, searchPages, visiblePages, type SitePage } from './site-map';

const pages: SitePage[] = [
  { path: '/stock/entries', title: 'Stock entries', description: '' },
  { path: '/stock/entries/new', title: 'New stock entry', description: 'receive purchases' },
  { path: '/finances/invoices', title: 'Invoices', description: 'Invoices list.' },
  { path: '/pos/sell', title: 'Point of sale', description: '' },
];

describe('site-map', () => {
  it('lists static screens from the manifest and gates them', () => {
    const all = allPages();
    expect(all.some((p) => p.path === '/stock/entries')).toBe(true);
    expect(all.some((p) => p.path.includes('['))).toBe(false);
    expect(
      visiblePages((p) => !p.startsWith('/stock')).some((p) => p.path.startsWith('/stock')),
    ).toBe(false);
  });

  it('resolves exact, trailing-slash, query and record-id paths', () => {
    expect(resolvePath('/stock/entries', pages)).toEqual({ ok: true, path: '/stock/entries' });
    expect(resolvePath('/stock/entries/?type=receipt', pages)).toEqual({
      ok: true,
      path: '/stock/entries',
    });
    expect(resolvePath('/stock/entries/abc-123', pages)).toEqual({
      ok: true,
      path: '/stock/entries/abc-123',
    });
    // No [param] child under /pos/sell in the manifest → invented, not a record.
    expect(
      resolvePath('/pos/sell/new', [...pages, { path: '/pos/sell', title: 'POS', description: '' }])
        .ok,
    ).toBe(false);
  });

  it('rejects unknown and off-origin paths with suggestions', () => {
    const r = resolvePath('/inventory', pages);
    expect(r.ok).toBe(false);
    expect(resolvePath('//evil.com', pages).ok).toBe(false);
    const s = resolvePath('/stock/entry', pages);
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.suggestions[0]?.path).toMatch(/^\/stock\/entries/);
  });

  it('searches by words in path, title and description', () => {
    expect(searchPages('invoice', pages)[0].path).toBe('/finances/invoices');
    expect(searchPages('purchases', pages)[0].path).toBe('/stock/entries/new');
    expect(searchPages('zzzz', pages)).toEqual([]);
  });
});
