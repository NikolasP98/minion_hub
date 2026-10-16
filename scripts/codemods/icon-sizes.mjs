#!/usr/bin/env node
/**
 * icon-sizes codemod — rewrites hardcoded icon literals to the `iconSizes` scale.
 *
 *   size={12|14|16|20} → size={iconSizes.xs|sm|md|lg}   (1:1)
 *   size={11|10} → xs, size={13} → sm, size={15} → md   (off-scale, spec 013 T008)
 *
 * Adds `iconSizes` to the file's `$lib/components/ui` import (or a new import in
 * the instance script). Skips `src/lib/components/ui/**` (the primitives),
 * third-party render surfaces from design-lint-exceptions.json, and `size={10}`
 * in files that render a `.t-telemetry` surface (the only sanctioned 10px).
 * Idempotent: a second run changes nothing.
 *
 *   node scripts/codemods/icon-sizes.mjs            # rewrite in place
 *   node scripts/codemods/icon-sizes.mjs --dry-run  # report only
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SIZE_MAP = {
  10: 'xs',
  11: 'xs',
  12: 'xs',
  13: 'sm',
  14: 'sm',
  15: 'md',
  16: 'md',
  20: 'lg',
};
const UI_IMPORT = /(^[ \t]*import\s*\{)([^}]*)(\}\s*from\s*'\$lib\/components\/ui';)/m;

/** Pure transform; returns { source, replaced, skipped } without touching disk. */
export function transform(source) {
  const keepTen = source.includes('t-telemetry');
  let replaced = 0;
  let skipped = 0;
  let out = source.replace(/\bsize=\{(\d+)\}/g, (whole, n) => {
    const key = SIZE_MAP[n];
    if (!key || (n === '10' && keepTen)) {
      skipped++;
      return whole;
    }
    replaced++;
    return `size={iconSizes.${key}}`;
  });
  if (replaced === 0) return { source, replaced, skipped };
  if (hasIconSizesImport(out)) return { source: out, replaced, skipped };
  const existing = out.match(UI_IMPORT);
  if (existing) {
    out = out.replace(
      UI_IMPORT,
      (_, open, specifiers, close) => `${open} iconSizes,${specifiers}${close}`,
    );
    return { source: out, replaced, skipped };
  }
  // No value import from the barrel: add one at the top of the instance script.
  const script = [...out.matchAll(/<script\b([^>]*)>/g)].find(
    (m) => !/\bmodule\b|context=/.test(m[1]),
  );
  if (!script)
    return { source, replaced: 0, skipped: skipped + replaced, error: 'no instance <script>' };
  const at = script.index + script[0].length;
  out = `${out.slice(0, at)}\n  import { iconSizes } from '$lib/components/ui';${out.slice(at)}`;
  return { source: out, replaced, skipped };
}

function hasIconSizesImport(source) {
  return [...source.matchAll(new RegExp(UI_IMPORT.source, 'gm'))].some((m) =>
    /\biconSizes\b/.test(m[2]),
  );
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name.endsWith('.svelte')) out.push(path);
  }
  return out;
}

export function run({ root, dryRun }) {
  const exceptions = JSON.parse(
    readFileSync(join(root, 'scripts/design-lint-exceptions.json'), 'utf8'),
  );
  const thirdParty = new Set(
    exceptions.exceptions
      .filter((e) => e.category === 'third-party-render-surface')
      .map((e) => e.file),
  );
  const report = [];
  for (const abs of walk(join(root, 'src'))) {
    const file = relative(root, abs);
    if (/^src\/lib\/components\/ui\//.test(file) || thirdParty.has(file)) continue;
    const before = readFileSync(abs, 'utf8');
    const result = transform(before);
    if (result.replaced === 0 && !result.error) continue;
    report.push({ file, ...result, source: undefined });
    if (!dryRun && result.source !== before) writeFileSync(abs, result.source);
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dryRun = process.argv.includes('--dry-run');
  const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
  const report = run({ root, dryRun });
  for (const r of report)
    console.log(
      `${String(r.replaced).padStart(3)} replaced ${String(r.skipped).padStart(3)} left  ${r.file}${r.error ? `  !! ${r.error}` : ''}`,
    );
  const total = report.reduce((n, r) => n + r.replaced, 0);
  console.log(
    `${dryRun ? '[dry-run] ' : ''}${total} icon literals → iconSizes in ${report.length} files`,
  );
}
