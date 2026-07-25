import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (_ctx: unknown, fn: (tx: unknown) => unknown) => fn(tx),
}));

/** Captures the SQL fragments drizzle's `sql` template produces. */
let lastSql = '';
const tx = {
  execute: (q: { queryChunks?: unknown[]; strings?: string[] }) => {
    lastSql = JSON.stringify(q);
    return Promise.resolve(rows);
  },
};
let rows: Array<{ code: string; id: string; is_alias: number }> = [];

import { loadProductMap } from './finance.service';

describe('loadProductMap — code + alias resolution', () => {
  it('resolves aliases, and a LIVE code always beats an alias', async () => {
    // Ordered as the query returns them: aliases first (is_alias desc), so the
    // later live row overwrites a colliding alias in the Map.
    rows = [
      { code: 'RSSVP', id: 'keeper', is_alias: 1 }, // retired code → keeper
      { code: 'RS-SVP', id: 'keeper', is_alias: 1 },
      { code: 'DUP', id: 'keeper', is_alias: 1 }, // alias that collides…
      { code: 'RSSP', id: 'keeper', is_alias: 0 },
      { code: 'DUP', id: 'someone-else', is_alias: 0 }, // …with a live code
    ];
    const map = await loadProductMap({ db: {} as never, tenantId: 'org-1' });

    expect(map.get('RSSVP')).toBe('keeper'); // the whole point: merges survive sync
    expect(map.get('RS-SVP')).toBe('keeper');
    expect(map.get('RSSP')).toBe('keeper');
    // A live code must never be hijacked by another product's stale alias.
    expect(map.get('DUP')).toBe('someone-else');
  });

  // ★ Regression guard for a bug that shipped silently: `lateral
  // jsonb_array_elements_text(...) as code` names the TABLE, so bare `code`
  // resolves to p.code and EVERY alias row returns the product's own live code
  // — the alias mechanism becomes a no-op with no error anywhere. 393 real
  // invoice lines failed to resolve before this was caught.
  it('uses the a(code) COLUMN alias, not a bare table alias', () => {
    const src = readFileSync(new URL('./finance.service.ts', import.meta.url), 'utf8');
    const q = src.slice(src.indexOf('export function loadProductMap'));
    const body = q.slice(0, q.indexOf('\n}'));
    expect(body).toContain('as a(code)');
    expect(body).toContain('a.code');
    expect(body).not.toMatch(/jsonb_array_elements_text\([^)]*\)\s*\)?\s*as code\b/);
  });
});
