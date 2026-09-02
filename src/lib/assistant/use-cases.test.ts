import { describe, expect, it } from 'vitest';
import { FORM_CATALOG } from './catalog';
import {
  allPages,
  describePages,
  MATCH_SCORE,
  rankPages,
  resolvePath,
  searchPages,
} from './site-map';
import { USE_CASES } from './use-cases';

const pages = allPages();

/** A hit is confident only when it scores at least a one-token prefix match. */
function topConfident(query: string): string | null {
  const [best] = rankPages(query, pages);
  return best && best.score >= MATCH_SCORE.prefix ? best.page.path : null;
}

describe('assistant use cases → searchPages', () => {
  it('covers the corpus', () => {
    const by = (s: string) => USE_CASES.filter((c) => c.stage === s).length;
    expect(USE_CASES.length).toBeGreaterThanOrEqual(40);
    for (const s of ['I', 'II', 'III', 'ambiguous', 'nonexistent'])
      expect(by(s)).toBeGreaterThan(0);
  });

  it.each(USE_CASES.map((c) => [c.text, c] as const))('%s', (_, c) => {
    expect(topConfident(c.text)).toBe(c.expectPath);
    if (c.expectPath === null) {
      const top = searchPages(c.text, pages)[0]?.path ?? null;
      expect(top).toBe(c.expectSuggestion ?? null);
    }
    if (c.expectForm) {
      const form = FORM_CATALOG.find((f) => f.id === c.expectForm);
      expect(form?.route).toBe(c.expectPath);
    }
  });
});

describe('assistant use cases → resolvePath', () => {
  const ok = (raw: string, path = raw) =>
    expect(resolvePath(raw, pages)).toEqual({ ok: true, path });
  const suggest = (raw: string, first: string) => {
    const r = resolvePath(raw, pages);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.suggestions[0]?.path).toBe(first);
  };

  it('accepts canonical paths the model would emit', () => {
    ok('/stock/entries/new');
    ok('/scheduling/bookings?new=1', '/scheduling/bookings');
    ok('/crm/abc-123');
    ok('finances/purchases/', '/finances/purchases');
  });

  it.each([
    ['/inventory', '/stock'],
    ['/inventario', '/stock'],
    ['/invoices', '/finances/invoices'],
    ['/purchases', '/finances/purchases'],
    ['/compras', '/finances/purchases'],
    ['/customers', '/crm/customers'],
    ['/clientes', '/crm/customers'],
    ['/appointments', '/scheduling/bookings'],
    ['/citas', '/scheduling/bookings'],
    ['/warehouse', '/stock/warehouses'],
    ['/almacen', '/stock/warehouses'],
    ['/pos', '/pos/sell'],
    ['/payroll', '/team'],
    ['/expenses', '/finances/purchases'],
  ])('%s → not ok, suggests %s', (raw, first) => suggest(raw, first));

  it('non-existent modules are never confident even when suggested', () => {
    for (const raw of ['/payroll', '/expenses', '/planilla', '/contabilidad']) {
      expect(resolvePath(raw, pages).ok).toBe(false);
      expect(topConfident(raw.slice(1))).toBeNull();
    }
  });
});

describe('form catalog ↔ site map', () => {
  const brief = describePages(pages);
  it.each(FORM_CATALOG.map((f) => [f.id, f.route] as const))(
    '%s route %s is a page',
    (_, route) => {
      expect(resolvePath(route, pages)).toEqual({ ok: true, path: route });
      expect(brief).toContain(`${route} — `);
    },
  );

  it('briefs keywords so the model sees synonyms', () => {
    expect(brief).toMatch(/\/stock\/entries\/new — .*\(.*mercaderia.*\)/);
    expect(brief).toMatch(/\/team — .*NO MODULE HERE for: .*payroll/);
    expect(brief).not.toContain('~');
  });
});
