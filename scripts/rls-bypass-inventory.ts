#!/usr/bin/env bun
/**
 * Inventory of files that reach the database outside the per-request RLS path
 * (`getCoreDb(` / `getDb(` / `supabaseAdmin(`). Spec 048 slice H2.
 *   bun scripts/rls-bypass-inventory.ts           print the JSON (keeps existing `class`)
 *   bun scripts/rls-bypass-inventory.ts --check   exit 1 if it differs from the committed JSON
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export type BypassEntry = { file: string; calls: string[]; class: string };

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const INVENTORY = join(ROOT, 'src/server/db/rls-bypass-inventory.json');
const CALLS = ['getCoreDb', 'getDb', 'supabaseAdmin'] as const;
const EXCLUDED = new Set([
  'src/server/db/pg-client.ts',
  'src/server/db/client.ts',
  'src/server/supabase.ts',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|svelte)$/.test(name) && !name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

function firstPassClass(file: string): string {
  if (/\/(user(-[^/]*)?\.service\.ts|user-[^/]*|preferences[^/]*|personal-agent[^/]*)$/.test(file))
    return 'user-scoped';
  if (
    /(organization-provision|organizations\.service|\/platform\/|metering|ai-usage|\/jobs\/|-jobs\.service|\/tick\/|-tick\.ts)/.test(
      file,
    )
  )
    return 'cross-org-by-design';
  return 'todo';
}

export function scanBypassSites(root = ROOT): BypassEntry[] {
  const known = new Map<string, string>();
  const inv = join(root, 'src/server/db/rls-bypass-inventory.json');
  if (existsSync(inv))
    for (const e of JSON.parse(readFileSync(inv, 'utf8')) as BypassEntry[])
      known.set(e.file, e.class);
  const out: BypassEntry[] = [];
  for (const abs of walk(join(root, 'src'))) {
    const file = relative(root, abs).split(sep).join('/');
    if (EXCLUDED.has(file)) continue;
    const text = readFileSync(abs, 'utf8');
    const calls = CALLS.filter((c) => text.includes(`${c}(`));
    if (calls.length) out.push({ file, calls, class: known.get(file) ?? firstPassClass(file) });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/** Human-readable differences between the scan and the committed inventory ([] = in sync). */
export function diffInventory(scan: BypassEntry[], committed: BypassEntry[]): string[] {
  const have = new Map(committed.map((e) => [e.file, e]));
  const now = new Map(scan.map((e) => [e.file, e]));
  const problems: string[] = [];
  for (const e of scan) {
    const c = have.get(e.file);
    if (!c) problems.push(`missing from inventory: ${e.file} (${e.calls.join(', ')})`);
    else if (c.calls.join() !== e.calls.join())
      problems.push(`calls changed: ${e.file} inventory=[${c.calls}] now=[${e.calls}]`);
  }
  for (const e of committed)
    if (!now.has(e.file)) problems.push(`stale inventory entry (no longer matches): ${e.file}`);
  return problems;
}

if (import.meta.main) {
  const scan = scanBypassSites();
  if (process.argv.includes('--check')) {
    const problems = diffInventory(scan, JSON.parse(readFileSync(INVENTORY, 'utf8')));
    if (problems.length) {
      console.error(problems.join('\n'));
      console.error(
        'Regenerate: bun scripts/rls-bypass-inventory.ts > src/server/db/rls-bypass-inventory.json',
      );
      process.exit(1);
    }
  } else console.log(JSON.stringify(scan, null, 2));
}
