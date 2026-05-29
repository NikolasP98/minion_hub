#!/usr/bin/env node
/**
 * design-lint — lightweight design-system drift guard.
 *
 * Caps the drift the UI council flagged (raw colors bypassing tokens, bare
 * <button>/<select> bypassing ui/ primitives) WITHOUT a full ESLint/stylelint
 * framework. Baseline-aware: existing violations are recorded once; the check
 * only *fails* (with --ci) when totals exceed the baseline — so the backlog
 * doesn't break CI, but new code can't add to it (ratchet-down).
 *
 *   node scripts/design-lint.mjs                 # report (always exit 0)
 *   node scripts/design-lint.mjs --ci            # exit 1 if any total > baseline
 *   node scripts/design-lint.mjs --update-baseline
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const SRC = join(root, 'src');
const BASELINE = join(root, 'scripts', '.design-lint-baseline.json');

// Files allowed to define raw colors (the token source of truth).
const COLOR_ALLOW = [/app\.css$/, /themes\/presets\.ts$/, /themes\/.*\.ts$/];
// ui/ primitives are *allowed* to use bare elements — they ARE the primitives.
const PRIMITIVE_DIR = /lib\/components\/ui\//;

const RULES = {
  'raw-color': {
    desc: 'literal rgba()/rgb()/#hex in .svelte — use design tokens instead',
    test: (file) => file.endsWith('.svelte') && !COLOR_ALLOW.some((re) => re.test(file)),
    // hex colors + rgb/rgba function literals
    re: /#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(/g,
  },
  'bare-button': {
    desc: 'bare <button> outside ui/ — prefer <Button> from $lib/components/ui',
    test: (file) => file.endsWith('.svelte') && !PRIMITIVE_DIR.test(file),
    re: /<button[\s>]/g,
  },
  'native-select': {
    desc: 'native <select> — prefer a themed Select primitive',
    test: (file) => file.endsWith('.svelte') && !PRIMITIVE_DIR.test(file),
    re: /<select[\s>]/g,
  },
};

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (name.endsWith('.svelte') || name.endsWith('.ts')) out.push(p);
  }
  return out;
}

function scan() {
  const totals = {};
  const offenders = {};
  for (const k of Object.keys(RULES)) {
    totals[k] = 0;
    offenders[k] = {};
  }
  for (const file of walk(SRC)) {
    const rel = relative(root, file);
    const text = readFileSync(file, 'utf8');
    for (const [k, rule] of Object.entries(RULES)) {
      if (!rule.test(rel)) continue;
      const n = (text.match(rule.re) || []).length;
      if (n > 0) {
        totals[k] += n;
        offenders[k][rel] = n;
      }
    }
  }
  return { totals, offenders };
}

const args = process.argv.slice(2);
const { totals, offenders } = scan();

if (args.includes('--update-baseline')) {
  writeFileSync(BASELINE, JSON.stringify({ totals, generatedFor: 'drift ratchet' }, null, 2) + '\n');
  console.log('design-lint: baseline written', totals);
  process.exit(0);
}

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')).totals : null;

console.log('\n  design-lint — design-system drift report\n');
let regressed = false;
for (const [k, rule] of Object.entries(RULES)) {
  const now = totals[k];
  const base = baseline?.[k] ?? null;
  const delta = base === null ? '' : now > base ? `  ▲ +${now - base} OVER baseline` : now < base ? `  ▼ -${base - now}` : '  = baseline';
  if (base !== null && now > base) regressed = true;
  console.log(`  ${k.padEnd(14)} ${String(now).padStart(4)}  (${rule.desc})${delta}`);
  // show top 3 offenders for context
  const top = Object.entries(offenders[k]).sort((a, b) => b[1] - a[1]).slice(0, 3);
  for (const [f, n] of top) console.log(`                   ${String(n).padStart(4)}  ${f}`);
}
console.log('');

if (args.includes('--ci') && regressed) {
  console.error('design-lint: ▲ drift increased over baseline — migrate to tokens/primitives or run --update-baseline if intentional.\n');
  process.exit(1);
}
process.exit(0);
