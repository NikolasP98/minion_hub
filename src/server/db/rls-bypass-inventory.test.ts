import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  diffInventory,
  scanBypassSites,
  type BypassEntry,
} from '../../../scripts/rls-bypass-inventory';

describe('RLS-bypass inventory (spec 048 H2)', () => {
  it('matches every getCoreDb/getDb/supabaseAdmin call site under src/', () => {
    const committed = JSON.parse(
      readFileSync(new URL('./rls-bypass-inventory.json', import.meta.url), 'utf8'),
    ) as BypassEntry[];
    expect(diffInventory(scanBypassSites(), committed)).toEqual([]);
  });

  it('reports a new unlisted call site and a stale entry', () => {
    const scan = scanBypassSites();
    const [first, ...rest] = scan;
    expect(diffInventory(scan, rest)[0]).toContain(`missing from inventory: ${first.file}`);
    expect(diffInventory(rest, scan)[0]).toContain(`stale inventory entry`);
  });
});
