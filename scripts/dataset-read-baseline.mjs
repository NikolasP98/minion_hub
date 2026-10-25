#!/usr/bin/env node
// Dataset-read ratchet inputs (spec 039). Counts bare tenant-handle acquisitions in (app) loads;
// `dataset-read.ratchet.test.ts` compares them to scripts/.dataset-read-baseline.json (decrease-only).
//   node scripts/dataset-read-baseline.mjs --print    current counts
//   node scripts/dataset-read-baseline.mjs --update   rewrite the baseline iff no count rose
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOADS_DIR = 'src/routes/(app)';
export const BASELINE_PATH = path.join(ROOT, 'scripts/.dataset-read-baseline.json');
const LOAD_FILE = /^\+(page|layout)\.server\.ts$/;
// `getCoreDb\(` sits outside the trailing \b: the spec's `(…|getCoreDb\(|…)\b` never matches `getCoreDb()`.
const BARE =
  /\b(?:getCoreCtx|requireCoreCtx|getTenantCtx|requireTenantCtx|withOrgCore)\b|\bgetCoreDb\(/g;

// Route prefix -> RBAC module. Duplicated from src/lib/modules/availability.ts (MODULE_MANIFEST
// appPrefixes), which a .mjs cannot import; the ratchet test asserts every manifest prefix is here.
export const PREFIX_MODULES = {
  '/crm': 'crm',
  '/finances': 'finance',
  '/socials': 'ads',
  '/sales': 'sales',
  '/support': 'support',
  '/scheduling': 'scheduling',
  '/memberships': 'memberships',
  '/team': 'scheduling',
  '/settings/team': 'scheduling',
  '/pulse': 'pulse',
  '/settings/pulse': 'pulse',
  '/pos': 'pos',
  '/pos/appointments': 'pos',
  '/stock': 'stock',
  '/workforce': 'projects',
  '/work': 'projects',
  '/brains': 'brains',
  '/agents': 'agents',
  '/channels': 'channels',
};

/** Longest-prefix module for a repo-relative load path; anything unmapped is `overview`. */
export function moduleForLoadPath(file) {
  const route = '/' + path.posix.dirname(file.slice(LOADS_DIR.length + 1)).replace(/^\./, '');
  const canonical = route.replace(/\/\([^/]*\)/g, '');
  let best = '';
  for (const p of Object.keys(PREFIX_MODULES)) {
    if ((canonical === p || canonical.startsWith(p + '/')) && p.length > best.length) best = p;
  }
  return best ? PREFIX_MODULES[best] : 'overview';
}

function walk(dir, out) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) walk(rel, out);
    else if (LOAD_FILE.test(e.name)) out.push(rel);
  }
  return out;
}

// Imports are stripped so only call sites count. shortcut: line-comment stripping ignores `//` inside strings (e.g. URLs); upgrade if a load needs it.
const strip = (s) =>
  s
    .replace(/^\s*import\s[\s\S]*?from\s+['"][^'"]+['"];?/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** repo-relative load file -> bare-handle count (files with 0 omitted), sorted. */
export function collect() {
  const out = {};
  for (const f of walk(LOADS_DIR, []).sort()) {
    const n = (strip(fs.readFileSync(path.join(ROOT, f), 'utf8')).match(BARE) ?? []).length;
    if (n > 0) out[f] = n;
  }
  return out;
}

const readRaw = () => JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
/** Load-read baseline (everything but the `apiGets` key). */
export function readBaseline() {
  const { apiGets: _api, ...loads } = readRaw();
  return loads;
}
/** API GET baseline: repo-relative `+server.ts` -> 1 (decrease-only). */
export function readApiBaseline() {
  return readRaw().apiGets ?? {};
}

// API GET bucket (T025): `src/routes/api/**/+server.ts` exporting GET with none of these guards.
// Heuristic by design (name match after comment stripping): it measures the unguarded-read surface so
// it can only shrink; it does not prove a handler is safe or unsafe.
const API_DIR = 'src/routes/api';
const GUARD = /\b(?:requireOrgCapability|requireAuth|requireAdmin|requireServerToken)\b/;
const EXPORTS_GET =
  /export\s+(?:const|async\s+function|function)\s+GET\b|export\s*\{[^}]*\bGET\b[^}]*\}/;
function walkApi(dir, out) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) walkApi(rel, out);
    else if (e.name === '+server.ts') out.push(rel);
  }
  return out;
}
export function collectApiGets() {
  const out = {};
  for (const f of walkApi(API_DIR, []).sort()) {
    const src = strip(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    if (EXPORTS_GET.test(src) && !GUARD.test(src)) out[f] = 1;
  }
  return out;
}

/** Rule violations for the API GET bucket: new files and stale keys. */
export function apiViolations(current, baseline) {
  const v = [];
  for (const f of Object.keys(current)) {
    if (!(f in baseline))
      v.push({
        rule: 'api-new',
        msg: `${f}: unguarded API GET — add requireOrgCapability/requireAuth or datasetCtx (spec 039 K3)`,
      });
  }
  for (const f of Object.keys(baseline)) {
    if (!(f in current))
      v.push({ rule: 'api-stale', msg: `${f}: baseline entry is stale — run --update` });
  }
  return v;
}

/** Ratchet rules; each violation carries its rule id so the test can assert per rule. */
export function violations(counts, baseline, enforced) {
  const v = [];
  const hint = (f) =>
    `use datasetCtx(locals, '${moduleForLoadPath(f)}') / readDataset (spec 039 J1)`;
  for (const [f, n] of Object.entries(counts)) {
    const msg = `${f}: ${n} bare tenant read(s) — ${hint(f)}`;
    if (enforced.includes(moduleForLoadPath(f))) v.push({ rule: 'enforced', msg });
    else if (!(f in baseline)) v.push({ rule: 'unknown', msg });
    else if (n > baseline[f]) v.push({ rule: 'raised', msg: `${msg} (baseline ${baseline[f]})` });
  }
  for (const f of Object.keys(baseline)) {
    if (!(f in counts) || counts[f] < baseline[f]) {
      v.push({ rule: 'stale', msg: `${f}: baseline ${baseline[f]} is stale — run --update` });
    }
  }
  return v;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const counts = collect();
  const arg = process.argv[2];
  if (arg === '--print') {
    for (const [f, n] of Object.entries(counts)) console.log(`${f}: ${n}`);
    console.log(
      `# ${Object.keys(counts).length} files, ${Object.values(counts).reduce((a, b) => a + b, 0)} reads`,
    );
    console.log(`# api GETs without a guard: ${Object.keys(collectApiGets()).length}`);
  } else if (arg === '--update') {
    const old = fs.existsSync(BASELINE_PATH) ? readRaw() : null;
    const raised = old ? Object.entries(counts).filter(([f, n]) => n > (old[f] ?? 0)) : [];
    if (raised.length) {
      console.error(
        'Refusing to raise the baseline:\n' +
          raised.map(([f, n]) => `  ${f}: ${old[f] ?? 0} -> ${n}`).join('\n'),
      );
      process.exit(1);
    }
    const api = collectApiGets();
    const oldApi = old ? (old.apiGets ?? null) : null;
    const apiRaised = oldApi ? Object.keys(api).filter((f) => !(f in oldApi)) : [];
    if (apiRaised.length) {
      console.error(
        'Refusing to add unguarded API GETs:\n' + apiRaised.map((f) => `  ${f}`).join('\n'),
      );
      process.exit(1);
    }
    fs.writeFileSync(BASELINE_PATH, JSON.stringify({ ...counts, apiGets: api }, null, 2) + '\n');
    console.log(
      `baseline written: ${Object.keys(counts).length} load files, ${Object.keys(api).length} api GETs`,
    );
  } else {
    console.error('usage: dataset-read-baseline.mjs --print | --update');
    process.exit(2);
  }
}
