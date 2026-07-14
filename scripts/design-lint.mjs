#!/usr/bin/env node
/**
 * design-lint — per-file design-system debt ratchet.
 *
 * The historical snapshot remains visible as migration evidence, while changed
 * files are compared with a git base. A feature cannot move debt between files
 * or add to a legacy file even while the repository-wide migration is incomplete.
 * The old snapshot is intentionally not a CI gate: it predates debt already on
 * the integration branch and must never force maintainers to raise the baseline.
 *
 *   node scripts/design-lint.mjs
 *   node scripts/design-lint.mjs --ci
 *   node scripts/design-lint.mjs --ci --base-ref origin/dev
 *   node scripts/design-lint.mjs --update-baseline   # decreases only
 *   node scripts/design-lint.mjs --ci --strict-global
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const SRC = join(root, 'src');
const BASELINE = join(root, 'scripts', '.design-lint-baseline.json');
const EXCEPTIONS = join(root, 'scripts', 'design-lint-exceptions.json');

const COLOR_ALLOW = [/app\.css$/, /themes\/presets\.ts$/, /themes\/.*\.ts$/];
const PRIMITIVE_DIR = /lib\/components\/ui\//;

const RULES = {
  'raw-color': {
    desc: 'literal rgba()/rgb()/#hex in .svelte — use design tokens instead',
    test: (file) => file.endsWith('.svelte') && !COLOR_ALLOW.some((re) => re.test(file)),
    re: /#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(/g,
  },
  'palette-utility': {
    desc: 'Tailwind palette utility in .svelte — use a semantic color role instead',
    test: (file) => file.endsWith('.svelte') && !COLOR_ALLOW.some((re) => re.test(file)),
    re: /\b(?:bg|text|border|ring|outline|divide|fill|stroke|from|via|to)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(?:-\d{2,3})?(?:\/\d{1,3})?\b/g,
  },
  'raw-radius': {
    desc: 'arbitrary radius in .svelte — use the radius scale or a named variant',
    test: (file) => file.endsWith('.svelte'),
    re: /\brounded-\[(?!var\()[^\]]+\]|\bborder-radius\s*:(?!\s*(?:0(?:\s|;|$)|var\(|calc\(var\())[^;}{]+/g,
  },
  'raw-spacing': {
    desc: 'arbitrary spacing in .svelte — use the spacing scale or semantic layout aliases',
    test: (file) => file.endsWith('.svelte'),
    re: /\b(?:p[trblxy]?|m[trblxy]?|gap(?:-[xy])?|space-[xy])-\[(?!(?:var|calc\(var|max\(var|min\(var|clamp\(var)\()[^\]]+\]|\b(?:padding|margin|gap|row-gap|column-gap)(?:-[a-z]+)?\s*:(?!\s*(?:0(?:\s|;|$)|-?1px(?:\s|;|$)|auto(?:\s|;|$)|var\(|(?:calc|max|min|clamp)\([^;}{]*var\(|env\())[^;}{]+/g,
  },
  'raw-shadow': {
    desc: 'arbitrary shadow in .svelte — use an elevation/focus/status recipe',
    test: (file) => file.endsWith('.svelte'),
    re: /\bshadow-\[(?!var\()[^\]]+\]|\bbox-shadow\s*:(?!\s*(?:none(?:\s|;|$)|var\())[^;}{]+/g,
  },
  'raw-motion': {
    desc: 'literal UI duration in .svelte — use duration/easing or motion recipes',
    test: (file) => file.endsWith('.svelte'),
    re: /\bduration-(?:\d+|\[(?!var\()[^\]]+\])\b|\b(?:transition(?:-duration)?|animation-duration)\s*:(?![^;}{]*var\()[^;}{]*(?:\d+(?:\.\d+)?ms|\d*\.\d+s)/g,
  },
  'raw-easing': {
    desc: 'literal easing in .svelte — use the standard enter/exit/spring recipes',
    test: (file) => file.endsWith('.svelte'),
    re: /\bease-\[(?!var\()[^\]]+\]|\b(?:transition-timing-function|animation-timing-function)\s*:(?!\s*var\()[^;}{]+/g,
  },
  'raw-layer': {
    desc: 'numeric z-index in .svelte — use a named layer token',
    test: (file) => file.endsWith('.svelte'),
    re: /\bz-(?:\d+|\[(?!var\()[^\]]+\])\b|\bz-index\s*:(?!\s*var\()[^;}{]*-?\d+/g,
  },
  'raw-type-size': {
    desc: 'arbitrary type size in .svelte — use a typography role',
    test: (file) => file.endsWith('.svelte'),
    re: /\btext-\[(?:\d+(?:\.\d+)?(?:px|rem))\]|\bfont-size\s*:(?!\s*var\()[^;}{]+/g,
  },
  'bare-button': {
    desc: 'bare <button> outside ui/ — prefer <Button> from $lib/components/ui',
    test: (file) => file.endsWith('.svelte') && !PRIMITIVE_DIR.test(file),
    re: /<button[\s>]/g,
  },
  'native-select': {
    desc: 'native <select> outside ui/ — prefer the themed Select primitive',
    test: (file) => file.endsWith('.svelte') && !PRIMITIVE_DIR.test(file),
    re: /<select[\s>]/g,
  },
};

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    ...options,
  });
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stats = statSync(path);
    if (stats.isDirectory()) walk(path, out);
    else if (name.endsWith('.svelte') || name.endsWith('.ts')) out.push(path);
  }
  return out;
}

const exceptionConfig = existsSync(EXCEPTIONS)
  ? JSON.parse(readFileSync(EXCEPTIONS, 'utf8'))
  : { schemaVersion: 1, exceptions: [] };

const EXCEPTION_CATEGORIES = new Set([
  'illustration',
  'theme-preview',
  'syntax',
  'data-visualization',
  'third-party-render-surface',
]);

function validateExceptions() {
  if (exceptionConfig.schemaVersion !== 1 || !Array.isArray(exceptionConfig.exceptions)) {
    throw new Error('design-lint exceptions must use schemaVersion 1 and an exceptions array');
  }

  const seen = new Set();
  for (const entry of exceptionConfig.exceptions) {
    const key = `${entry.file}:${entry.rule}`;
    if (seen.has(key)) throw new Error(`duplicate design-lint exception: ${key}`);
    seen.add(key);
    if (!entry.file?.startsWith('src/') || !RULES[entry.rule]) {
      throw new Error(`invalid design-lint exception target: ${key}`);
    }
    if (!Number.isInteger(entry.allowance) || entry.allowance < 1) {
      throw new Error(`design-lint exception allowance must be a positive integer: ${key}`);
    }
    if (!EXCEPTION_CATEGORIES.has(entry.category) || !entry.reason?.trim()) {
      throw new Error(`design-lint exception requires an approved category and reason: ${key}`);
    }
  }
}

validateExceptions();

function allowance(file, rule) {
  return exceptionConfig.exceptions
    .filter((entry) => entry.file === file && entry.rule === rule)
    .reduce((total, entry) => total + entry.allowance, 0);
}

function countText(file, text) {
  const counts = {};
  for (const [key, rule] of Object.entries(RULES)) {
    const raw = rule.test(file) ? (text.match(rule.re) || []).length : 0;
    counts[key] = { raw, governed: Math.max(0, raw - allowance(file, key)) };
  }
  return counts;
}

function scan() {
  const totals = Object.fromEntries(Object.keys(RULES).map((key) => [key, 0]));
  const governedTotals = Object.fromEntries(Object.keys(RULES).map((key) => [key, 0]));
  const offenders = Object.fromEntries(Object.keys(RULES).map((key) => [key, {}]));

  for (const absolutePath of walk(SRC)) {
    const file = relative(root, absolutePath);
    const counts = countText(file, readFileSync(absolutePath, 'utf8'));
    for (const key of Object.keys(RULES)) {
      totals[key] += counts[key].raw;
      governedTotals[key] += counts[key].governed;
      if (counts[key].raw > 0) offenders[key][file] = counts[key].raw;
    }
  }
  return { totals, governedTotals, offenders };
}

function requestedBaseRef(args) {
  const explicit = args.find((arg) => arg.startsWith('--base-ref='))?.split('=', 2)[1];
  if (explicit) return explicit;
  const index = args.indexOf('--base-ref');
  if (index >= 0) return args[index + 1];
  if (process.env.DESIGN_LINT_BASE_REF) return process.env.DESIGN_LINT_BASE_REF;
  if (process.env.GITHUB_BASE_REF) return `origin/${process.env.GITHUB_BASE_REF}`;
  return 'origin/dev';
}

function refExists(ref) {
  try {
    git(['rev-parse', '--verify', ref]);
    return true;
  } catch {
    return false;
  }
}

function changedFiles(ref) {
  const tracked = git(['diff', '--name-only', ref, '--', 'src']).split('\n').filter(Boolean);
  const untracked = git(['ls-files', '--others', '--exclude-standard', 'src'])
    .split('\n')
    .filter(Boolean);
  return [...new Set([...tracked, ...untracked])].filter(
    (file) => file.endsWith('.svelte') || file.endsWith('.ts'),
  );
}

function textAtRef(ref, file) {
  try {
    return git(['show', `${ref}:${file}`]);
  } catch {
    return '';
  }
}

const args = process.argv.slice(2);
const current = scan();
const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')).totals : null;

if (args.includes('--update-baseline')) {
  if (baseline) {
    const increases = Object.keys(RULES).filter((key) => current.totals[key] > baseline[key]);
    if (increases.length > 0) {
      console.error(`design-lint: refusing to raise baseline for ${increases.join(', ')}`);
      process.exit(1);
    }
  }
  writeFileSync(
    BASELINE,
    `${JSON.stringify({ totals: current.totals, generatedFor: 'decrease-only global ceiling' }, null, 2)}\n`,
  );
  console.log('design-lint: baseline ratcheted down', current.totals);
  process.exit(0);
}

console.log('\n  design-lint — design-system debt report\n');
let globalRegression = false;
for (const [key, rule] of Object.entries(RULES)) {
  const now = current.totals[key];
  const base = baseline?.[key] ?? null;
  const delta =
    base === null
      ? ''
      : now > base
        ? `  ▲ +${now - base} OVER global ceiling`
        : now < base
          ? `  ▼ -${base - now}`
          : '  = global ceiling';
  if (base !== null && now > base) globalRegression = true;
  const exempted = now - current.governedTotals[key];
  console.log(
    `  ${key.padEnd(14)} ${String(now).padStart(4)}  (${rule.desc})${delta}${exempted ? `; ${exempted} reason-coded` : ''}`,
  );
  const top = Object.entries(current.offenders[key])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  for (const [file, count] of top)
    console.log(`                   ${String(count).padStart(4)}  ${file}`);
}

const baseRef = requestedBaseRef(args);
let fileRegressions = [];
if (baseRef && refExists(baseRef)) {
  for (const file of changedFiles(baseRef)) {
    const absolutePath = join(root, file);
    const now = existsSync(absolutePath)
      ? countText(file, readFileSync(absolutePath, 'utf8'))
      : countText(file, '');
    const before = countText(file, textAtRef(baseRef, file));
    for (const key of Object.keys(RULES)) {
      if (now[key].governed > before[key].governed) {
        fileRegressions.push({
          file,
          rule: key,
          before: before[key].governed,
          now: now[key].governed,
        });
      }
    }
  }
  console.log(`\n  per-file base  ${baseRef}`);
  if (fileRegressions.length === 0)
    console.log('  per-file debt  no changed file increased governed debt');
  for (const item of fileRegressions) {
    console.log(`  ▲ ${item.rule.padEnd(13)} ${item.before} → ${item.now}  ${item.file}`);
  }
} else {
  console.warn(`\n  per-file debt  skipped: git base '${baseRef}' is unavailable`);
}

console.log('');
if (
  args.includes('--ci') &&
  (fileRegressions.length > 0 ||
    !refExists(baseRef) ||
    (args.includes('--strict-global') && globalRegression))
) {
  console.error('design-lint: debt gate failed — changed files may not increase governed debt.\n');
  process.exit(1);
}
