#!/usr/bin/env node
/**
 * design-lint — per-file design-system debt ratchet.
 *
 * The baseline holds GOVERNED totals (raw hits minus reason-coded exceptions);
 * `--strict-global` fails when any rule rises above it. Changed
 * files are compared with a git base. A feature cannot move debt between files
 * or add to a legacy file even while the repository-wide migration is incomplete.
 * The old snapshot is intentionally not a CI gate: it predates debt already on
 * the integration branch and must never force maintainers to raise the baseline.
 *
 *   node scripts/design-lint.mjs
 *   node scripts/design-lint.mjs --ci
 *   node scripts/design-lint.mjs --ci --base-ref origin/master
 *   node scripts/design-lint.mjs --ci --zero-changed --base-ref <wave-base>
 *   node scripts/design-lint.mjs --update-baseline   # decreases only
 *   node scripts/design-lint.mjs --ci --strict-global
 *   node scripts/design-lint.mjs --ci --strict-global --zero-global
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.DESIGN_LINT_ROOT
  ? resolve(process.env.DESIGN_LINT_ROOT)
  : join(fileURLToPath(import.meta.url), '..', '..');
const SRC = join(root, 'src');
const BASELINE = join(root, 'scripts', '.design-lint-baseline.json');
const EXCEPTIONS = join(root, 'scripts', 'design-lint-exceptions.json');

const COLOR_ALLOW = [/app\.css$/, /themes\/presets\.ts$/, /themes\/.*\.ts$/];
const PRIMITIVE_DIR = /lib\/components\/ui\//;

const RULES = {
  'raw-color': {
    desc: 'literal rgba()/rgb()/#hex in .svelte — use design tokens instead',
    test: (file) => /\.(svelte|css)$/.test(file) && !COLOR_ALLOW.some((re) => re.test(file)),
    re: /#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(/g,
  },
  'palette-utility': {
    desc: 'Tailwind palette utility in .svelte — use a semantic color role instead',
    test: (file) => /\.(svelte|css)$/.test(file) && !COLOR_ALLOW.some((re) => re.test(file)),
    re: /\b(?:bg|text|border|ring|outline|divide|fill|stroke|from|via|to)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(?:-\d{2,3})?(?:\/\d{1,3})?\b/g,
  },
  'raw-radius': {
    desc: 'arbitrary radius in .svelte — use the radius scale or a named variant',
    test: (file) => /\.(svelte|css)$/.test(file),
    re: /\brounded-\[(?!var\()[^\]]+\]|\bborder-radius\s*:(?!\s*(?:0(?:\s|;|$)|var\(|calc\(var\())[^;}{]+/g,
  },
  'raw-spacing': {
    desc: 'arbitrary spacing in .svelte — use the spacing scale or semantic layout aliases',
    test: (file) => /\.(svelte|css)$/.test(file),
    re: /\b(?:p[trblxy]?|m[trblxy]?|gap(?:-[xy])?|space-[xy])-\[(?!(?:var|calc\(var|max\(var|min\(var|clamp\(var)\()[^\]]+\]|\b(?:padding|margin|gap|row-gap|column-gap)(?:-[a-z]+)?\s*:(?!\s*(?:0(?:\s|;|$)|-?1px(?:\s|;|$)|auto(?:\s|;|$)|var\(|(?:calc|max|min|clamp)\([^;}{]*var\(|env\())[^;}{]+/g,
  },
  'raw-shadow': {
    desc: 'arbitrary shadow in .svelte — use an elevation/focus/status recipe',
    test: (file) => /\.(svelte|css)$/.test(file),
    re: /\bshadow-\[(?!var\()[^\]]+\]|\bbox-shadow\s*:(?!\s*(?:none(?:\s|;|$)|var\())[^;}{]+/g,
  },
  'raw-motion': {
    desc: 'literal UI duration in .svelte — use duration/easing or motion recipes',
    test: (file) => /\.(svelte|css)$/.test(file),
    re: /\bduration-(?:\d+|\[(?!var\()[^\]]+\])\b|\b(?:transition(?:-duration)?|animation-duration)\s*:(?![^;}{]*var\()[^;}{]*(?:\d+(?:\.\d+)?ms|\d*\.\d+s)/g,
  },
  'raw-easing': {
    desc: 'literal easing in .svelte — use the standard enter/exit/spring recipes',
    test: (file) => /\.(svelte|css)$/.test(file),
    re: /\bease-\[(?!var\()[^\]]+\]|\b(?:transition-timing-function|animation-timing-function)\s*:(?!\s*var\()[^;}{]+/g,
  },
  'raw-layer': {
    desc: 'numeric z-index in .svelte — use a named layer token',
    test: (file) => /\.(svelte|css)$/.test(file),
    re: /\bz-(?:\d+|\[(?!var\()[^\]]+\])\b|\bz-index\s*:(?!\s*var\()[^;}{]*-?\d+/g,
  },
  'raw-type-size': {
    desc: 'arbitrary type size in .svelte — use a typography role',
    test: (file) => /\.(svelte|css)$/.test(file),
    re: /\btext-\[(?:\d+(?:\.\d+)?(?:px|rem))\]|\bfont-size\s*:(?!\s*var\()[^;}{]+/g,
  },
  'bare-button': {
    desc: 'bare <button> outside ui/ — prefer <Button> from $lib/components/ui',
    test: (file) => /\.(svelte|css)$/.test(file) && !PRIMITIVE_DIR.test(file),
    re: /<button[\s>]/g,
  },
  'native-select': {
    desc: 'native <select> outside ui/ — prefer the themed Select primitive',
    test: (file) => /\.(svelte|css)$/.test(file) && !PRIMITIVE_DIR.test(file),
    re: /<select[\s>]/g,
  },
  'raw-icon-size': {
    desc: 'hardcoded numeric size={N} — use iconSizes from $lib/components/ui (mirrors --icon-size-*)',
    test: (file) => /\.(svelte|css)$/.test(file),
    re: /\bsize=\{\d+\}/g,
  },
  'raw-loading': {
    desc: 'hand-rolled animate-spin/pulse outside ui/ — use Spinner/Skeleton or the .skeleton utility',
    test: (file) => /\.(svelte|css)$/.test(file) && !PRIMITIVE_DIR.test(file),
    re: /\banimate-(?:spin|pulse)\b/g,
  },
  'raw-control-height': {
    desc: 'raw 20–48px height outside ui/ — use a --control-height-* token',
    test: (file) => /\.(svelte|css)$/.test(file) && !PRIMITIVE_DIR.test(file),
    // Three shapes of the same bug: a CSS `height`/`min-height` declaration, a
    // Tailwind arbitrary `h-[…]`/`min-h-[…]`, or a plain scale utility `h-N`
    // (N * 4px, Tailwind's default spacing step) — each flagged only when its
    // resolved length falls in the 20–48px control-height band (see `filter`).
    re: /(?<![\w-])(?:min-)?height\s*:\s*(?!var\()(?<cssVal>\d+(?:\.\d+)?)(?<cssUnit>px|rem|em)\b|\b(?:min-)?h-\[(?!var\()(?<brVal>\d+(?:\.\d+)?)(?<brUnit>px|rem|em)\]|\b(?:min-)?h-(?<twVal>\d+(?:\.\d+)?)\b/g,
    filter: (match) => {
      const inRange = (px) => px >= 20 && px <= 48;
      const toPx = (value, unit) => (unit === 'px' ? value : value * 16);
      if (match.groups.cssVal)
        return inRange(toPx(parseFloat(match.groups.cssVal), match.groups.cssUnit));
      if (match.groups.brVal)
        return inRange(toPx(parseFloat(match.groups.brVal), match.groups.brUnit));
      if (match.groups.twVal !== undefined) return inRange(parseFloat(match.groups.twVal) * 4);
      return false;
    },
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
    else if (/\.(svelte|css|ts)$/.test(name)) out.push(path);
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
    let raw = 0;
    if (rule.test(file)) {
      if (rule.filter) {
        for (const match of text.matchAll(rule.re)) if (rule.filter(match)) raw++;
      } else {
        raw = (text.match(rule.re) || []).length;
      }
    }
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
  return 'origin/master';
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
  return [...new Set([...tracked, ...untracked])].filter((file) => /\.(svelte|css|ts)$/.test(file));
}

/** new path -> path it was moved/copied from (spec 039 page-body extraction): moved debt is not new debt. */
function movedFrom(ref) {
  const out = new Map();
  for (const line of git(['diff', '-M', '-C', '--name-status', ref, '--', 'src']).split('\n')) {
    const [status, from, to] = line.split('\t');
    if (to && /^[RC]/.test(status)) out.set(to, from);
  }
  return out;
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
const globalGovernedDebt = Object.values(current.governedTotals).reduce(
  (total, count) => total + count,
  0,
);

if (args.includes('--update-baseline')) {
  if (baseline) {
    const increases = Object.keys(RULES).filter(
      (key) => current.governedTotals[key] > baseline[key],
    );
    if (increases.length > 0) {
      console.error(`design-lint: refusing to raise baseline for ${increases.join(', ')}`);
      process.exit(1);
    }
  }
  writeFileSync(
    BASELINE,
    `${JSON.stringify(
      {
        totals: current.governedTotals,
        generatedFor: 'decrease-only global ceiling (governed = raw minus reason-coded)',
      },
      null,
      2,
    )}\n`,
  );
  console.log('design-lint: baseline ratcheted down', current.governedTotals);
  process.exit(0);
}

console.log('\n  design-lint — design-system debt report\n');
let globalRegression = false;
for (const [key, rule] of Object.entries(RULES)) {
  const now = current.governedTotals[key];
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
  const exempted = current.totals[key] - now;
  console.log(
    `  ${key.padEnd(14)} ${String(now).padStart(4)}  (${rule.desc})${delta}${exempted ? `; +${exempted} reason-coded` : ''}`,
  );
  const top = Object.entries(current.offenders[key])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  for (const [file, count] of top)
    console.log(`                   ${String(count).padStart(4)}  ${file}`);
}

const baseRef = requestedBaseRef(args);
let fileRegressions = [];
let changedFileDebt = [];
if (baseRef && refExists(baseRef)) {
  // Compare against the fork point: debt the base removed after branching is not ours.
  const forkPoint = execFileSync('git', ['merge-base', baseRef, 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  const moved = movedFrom(forkPoint);
  for (const file of changedFiles(forkPoint)) {
    const absolutePath = join(root, file);
    const now = existsSync(absolutePath)
      ? countText(file, readFileSync(absolutePath, 'utf8'))
      : countText(file, '');
    const before = countText(file, textAtRef(forkPoint, moved.get(file) ?? file));
    for (const key of Object.keys(RULES)) {
      if (now[key].governed > before[key].governed) {
        fileRegressions.push({
          file,
          rule: key,
          before: before[key].governed,
          now: now[key].governed,
        });
      }
      if (args.includes('--zero-changed') && now[key].governed > 0) {
        changedFileDebt.push({ file, rule: key, now: now[key].governed });
      }
    }
  }
  console.log(`\n  per-file base  ${baseRef}`);
  if (fileRegressions.length === 0)
    console.log('  per-file debt  no changed file increased governed debt');
  for (const item of fileRegressions) {
    console.log(`  ▲ ${item.rule.padEnd(13)} ${item.before} → ${item.now}  ${item.file}`);
  }
  if (args.includes('--zero-changed')) {
    console.log('\n  migrated-file debt');
    if (changedFileDebt.length === 0) {
      console.log('  zero governed debt in changed files');
    }
    for (const item of changedFileDebt) {
      console.log(`  ✕ ${item.rule.padEnd(13)} ${String(item.now).padStart(4)}  ${item.file}`);
    }
  }
} else {
  console.error(
    `\n  per-file debt  FAILED: git base '${baseRef}' is unavailable; fetch the registered base or pass --base-ref`,
  );
}

console.log('');
if (args.includes('--zero-global')) {
  console.log(`  global governed debt  ${globalGovernedDebt}`);
  if (globalGovernedDebt === 0) console.log('  global migration      complete');
  console.log('');
}
if (
  fileRegressions.length > 0 ||
  changedFileDebt.length > 0 ||
  !refExists(baseRef) ||
  (args.includes('--strict-global') && globalRegression) ||
  (args.includes('--zero-global') && globalGovernedDebt > 0)
) {
  console.error(
    'design-lint: debt gate failed — changed files may not increase governed debt; migrated files and the global program must reach zero when their zero gates are set.\n',
  );
  process.exit(1);
}
