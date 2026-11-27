/**
 * House-rules counters (spec 138 H1). Counts may only fall; a rise, a new file or a stale
 * baseline entry fails with the rule id and file. Refresh after lowering a count:
 *   HOUSE_RULES_UPDATE=1 bunx vitest run scripts/house-rules/house-rules.test.ts
 * Update mode rewrites baseline.json but still fails on any `raised` or `new`.
 * First creation only: HOUSE_RULES_INIT=1 writes the baseline unconditionally.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { SYSTEM_AUTOMATIONS } from '../../src/lib/automations/system-automations';
import { RULES } from './rules.mjs';
import { diff, scan } from './scan.mjs';

const ROOT = process.cwd();
const BASELINE_PATH = join(ROOT, 'scripts/house-rules/baseline.json');
const sorted = (o: Record<string, Record<string, number>>) =>
  Object.fromEntries(
    Object.keys(o)
      .sort()
      .map((r) => [
        r,
        Object.fromEntries(Object.entries(o[r]).sort(([a], [b]) => a.localeCompare(b))),
      ]),
  );

const tmpRoots: string[] = [];
function fixtureRoot(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'house-rules-'));
  tmpRoots.push(root);
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    writeFileSync(join(root, f), text);
  }
  return root;
}
afterAll(() => tmpRoots.forEach((r) => rmSync(r, { recursive: true, force: true })));

describe('house rules harness', () => {
  it('D1: a file gaining a violation is reported as new', () => {
    const root = fixtureRoot({
      'src/lib/A.svelte': '<script>function go() { if (confirm("sure?")) run(); }</script>',
      'src/lib/B.svelte': '<script>// confirm("no")\nconst x = obj.confirm("no");</script>',
    });
    const current = scan(RULES, root);
    expect(current['native-confirm']).toEqual({ 'src/lib/A.svelte': 1 });
    expect(diff(current, {})).toContainEqual({
      rule: 'native-confirm',
      file: 'src/lib/A.svelte',
      kind: 'new',
      was: 0,
      now: 1,
    });
    const raised = diff(current, { 'native-confirm': { 'src/lib/A.svelte': 0 } });
    expect(raised.map((v) => v.kind)).toEqual(['raised']);
  });

  it('counts multi-line Modal imports and raw write fetches', () => {
    const root = fixtureRoot({
      'src/lib/M.svelte':
        '<script lang="ts">\n  import {\n    Modal,\n    Button,\n  } from "$lib/components/ui";\n</script>',
      'src/lib/N.svelte': '<script>import Modal from "$lib/components/ui/Modal.svelte";</script>',
      'src/lib/Ok.svelte': '<script>import { Button } from "$lib/components/ui";</script>',
      'src/lib/F.svelte': '<script>fetch("/api/x", { method: "POST" });</script>',
    });
    const current = scan(RULES, root);
    expect(Object.keys(current['deprecated-modal']).sort()).toEqual([
      'src/lib/M.svelte',
      'src/lib/N.svelte',
    ]);
    expect(current['raw-write-fetch']).toEqual({ 'src/lib/F.svelte': 1 });
  });

  it('D2: a lowered count with an unchanged baseline is stale', () => {
    expect(diff({ r: { 'a.ts': 1 } }, { r: { 'a.ts': 2 } })).toEqual([
      { rule: 'r', file: 'a.ts', kind: 'stale', was: 2, now: 1 },
    ]);
    expect(diff({ r: {} }, { r: { 'a.ts': 1 } })[0].kind).toBe('stale');
  });

  it('D3: the committed tree equals the committed baseline', () => {
    const current = scan(RULES, ROOT);
    if (process.env.HOUSE_RULES_INIT === '1')
      writeFileSync(BASELINE_PATH, JSON.stringify(sorted(current), null, 2) + '\n');
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
    const bad = diff(current, baseline);
    const worse = bad.filter((v) => v.kind !== 'stale');
    if (process.env.HOUSE_RULES_UPDATE === '1' && worse.length === 0)
      writeFileSync(BASELINE_PATH, JSON.stringify(sorted(current), null, 2) + '\n');
    else
      expect(
        bad.map((v) => `${v.rule}: ${v.file} ${v.kind} (baseline ${v.was}, now ${v.now})`),
      ).toEqual([]);
    expect(worse).toEqual([]);
  });

  it('D4: every /tick route has a SYSTEM_AUTOMATIONS row', () => {
    const routes: string[] = [];
    const walkRoutes = (dir: string) => {
      for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (!e.isDirectory()) continue;
        if (e.name === 'tick' && readdirSync(join(ROOT, rel)).includes('+server.ts'))
          routes.push(rel.replace('src/routes', '').replace(/\/\([^/]*\)/g, ''));
        else walkRoutes(rel);
      }
    };
    walkRoutes('src/routes/api');
    const listed = new Set(SYSTEM_AUTOMATIONS.map((a) => a.path.split('?')[0]));
    expect(routes.filter((r) => !listed.has(r))).toEqual([]);
    expect(routes).toContain('/api/pulse/tick');
  });
});
