/**
 * S3 of 2026-08-17-hub-igv-rate-from-org-config-spec — the anti-recurrence
 * guard. The proposal's third DoD clause is "grep confirms no module-level rate
 * constant remains"; a grep in a spec is a one-time check, a grep in a test is a
 * permanent one. `0.18` was a *design assumption* here ("totals/IGV are DERIVED
 * (18%…), never passed in"), so it is the kind of constant that grows back.
 *
 * Scope: the emission library plus every production caller that constructs an
 * `EmissionInvoice`. The single sanctioned default lives outside all of them,
 * in `finance/tax.ts` (`DEFAULT_IGV_RATE`, applied by `resolveIgvRate` at the
 * settings boundary).
 *
 * `pos-emission-mapping.ts` is guarded explicitly, not just
 * `pos-emission.service.ts`: `ticketToEmission` (the actual `EmissionInvoice`
 * constructor S1 fixed) lives in the mapping module — the service only
 * imports and calls it. A `0.18` reintroduced at that construction site would
 * pass this guard entirely if only the service file were scanned.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const EMISSION_DIR = import.meta.dirname;
const EXTRA_GUARDED = [
  join(EMISSION_DIR, '../../services/pos-emission.service.ts'),
  join(EMISSION_DIR, '../../services/pos-emission-mapping.ts'),
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) return [];
    return [full];
  });
}

/**
 * Drop comments before matching. Prose that *explains* the absent constant
 * (ubl.ts's formatter doc-comment says «becomes "18", not "18.00"») must not
 * red the suite — only code may. Lines holding a `://` URL keep their tail, so
 * an xmlns declaration cannot hide a literal behind it.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      if (line.includes('://')) return line;
      const at = line.indexOf('//');
      return at === -1 ? line : line.slice(0, at);
    })
    .join('\n');
}

/** The rules, applied to already-comment-stripped code. One implementation,
 *  used both against the real library and against the fixtures below. */
function offendingLines(code: string): string[] {
  const found: string[] = [];

  for (const [i, line] of code.split('\n').entries()) {
    const at = `${i + 1}`;
    // 1. The literal itself, in any expression — the exact shape S1 deleted…
    if (/(?:^|[^\w.])0\.18(?![0-9])/.test(line)) found.push(`${at}: bare 0.18 literal`);
    // …and its divisor twin, which does the same damage: `total / 1.18`.
    if (/(?:^|[^\w.])1\.18(?![0-9])/.test(line)) found.push(`${at}: hardcoded 1.18 divisor`);
    // 2. A bare 18 sitting next to the words it would be a rate for.
    if (/(?:^|[^\w.])18(?![\w.])/.test(line) && /percent|igv|rate/i.test(line)) {
      found.push(`${at}: bare 18 adjacent to percent/IGV/rate`);
    }
  }

  // 3. A named numeric constant that reads like a rate, whatever its value —
  //    `const IGV_RATE = 0.1` is the same bug wearing a different number.
  for (const m of code.matchAll(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*number\s*)?=\s*-?\d+(?:\.\d+)?\s*[;,)]/g,
  )) {
    if (/rate|igv|percent|tax/i.test(m[1])) found.push(`numeric constant \`${m[1]}\``);
  }

  return found;
}

describe('S3 — no hardcoded tax rate in the emission library', () => {
  it('guards every non-test source under emission/ plus its production caller', () => {
    const files = [...sourceFiles(EMISSION_DIR), ...EXTRA_GUARDED];
    // Sanity: the walker must actually be finding the library, or this test
    // would pass by looking at nothing.
    expect(files.map((f) => relative(EMISSION_DIR, f))).toEqual(
      expect.arrayContaining(['ubl.ts', 'summary.ts', 'types.ts', 'index.ts']),
    );

    const offenders = files.flatMap((file) => {
      const where = relative(EMISSION_DIR, file);
      return offendingLines(stripComments(readFileSync(file, 'utf8'))).map((o) => `${where}:${o}`);
    });
    expect(
      offenders,
      'a tax rate was reintroduced into the emission library — the rate is an input ' +
        '(`EmissionInvoice.igvRate`), resolved once by `resolveIgvRate` in src/server/finance/tax.ts',
    ).toEqual([]);
  });

  it.each([
    'const IGV_RATE = 0.18;',
    'const rate = 0.1;',
    'return round(total / 1.18, 2);',
    'const percent = "18"; /* igv */',
    'const x = igvPercent(18);',
  ])('detects the offending shape: %s', (snippet) => {
    expect(offendingLines(stripComments(snippet))).not.toEqual([]);
  });

  it.each([
    '/** a rate of eighteen percent becomes "18", not "18.00" */',
    'const percent = formatPercent(inv.igvRate);',
    'const totalExclTax = round(totalInclTax / (1 + inv.igvRate), 2);',
    'xmlns:ds="http://www.w3.org/2000/09/xmldsig#" // rate',
  ])('leaves legitimate code alone: %s', (snippet) => {
    expect(offendingLines(stripComments(snippet))).toEqual([]);
  });
});
