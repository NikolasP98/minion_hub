import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Anti-recurrence guard (spec 2026-08-17-hub-igv-rate-from-org-config-spec §S3).
 * The proposal's DoD said "grep confirms no module-level rate constant remains" —
 * a grep in a spec is a one-time check, a grep in a test is a permanent one.
 * `const IGV_RATE = 0.18` lived in ubl.ts for three days and silently emitted
 * 18% documents for every org, whatever they had configured.
 *
 * The rate has exactly ONE home: `resolveIgvRate()` / `DEFAULT_IGV_RATE` in
 * src/server/finance/tax.ts. Inside this library it only ever arrives as
 * `EmissionInvoice.igvRate`.
 */

const EMISSION_DIR = import.meta.dirname;
const FIX_IT = 'Rates belong to resolveIgvRate()/DEFAULT_IGV_RATE in src/server/finance/tax.ts; inside emission/ the rate arrives only as EmissionInvoice.igvRate.';

/** Library sources only — test files and fixtures legitimately spell rates out. */
function librarySources(): Array<{ file: string; raw: string }> {
  return readdirSync(EMISSION_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .sort()
    .map((file) => ({ file, raw: readFileSync(join(EMISSION_DIR, file), 'utf8') }));
}

/** Comments may *discuss* rates ("an 18% rate is 18 / 100"); code may not contain one. */
function stripComments(src: string): string {
  return src.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('no hardcoded tax rate survives in the emission library', () => {
  const sources = librarySources();

  it('scans a non-trivial set of library files (guard cannot silently scan nothing)', () => {
    expect(sources.length).toBeGreaterThanOrEqual(6);
    expect(sources.map((s) => s.file)).toContain('ubl.ts');
    expect(sources.map((s) => s.file)).toContain('summary.ts');
  });

  it.each(sources.map((s) => s.file))('%s declares no rate/percent constant', (file) => {
    const code = stripComments(sources.find((s) => s.file === file)!.raw);
    // `const IGV_RATE = 0.18`, `let taxRate = 18`, `const IGV_PERCENT = 18` …
    const rateConst = /(?:const|let|var)\s+\w*(?:RATE|[Rr]ate|PERCENT|[Pp]ercent)\w*\s*=\s*[\d.]/.exec(code);
    expect(rateConst?.[0], `${file}: rate constant. ${FIX_IT}`).toBeUndefined();
  });

  it.each(sources.map((s) => s.file))('%s contains no fractional-rate literal', (file) => {
    const code = stripComments(sources.find((s) => s.file === file)!.raw);
    // Any literal in (0, 1) — the shape every tax rate has in this codebase.
    const fraction = /\b0\.\d+\b/.exec(code);
    expect(fraction?.[0], `${file}: fractional literal ${fraction?.[0]}. ${FIX_IT}`).toBeUndefined();
  });

  it.each(sources.map((s) => s.file))('%s never divides or multiplies by a literal 1 + rate', (file) => {
    const code = stripComments(sources.find((s) => s.file === file)!.raw);
    // `totalIncl / 1.18` — the tax-inclusive divisor with the rate baked in,
    // the one rate literal that is NOT a bare fraction.
    const baked = /[/*]\s*1\.\d+/.exec(code);
    expect(baked?.[0], `${file}: literal tax-inclusive divisor ${baked?.[0]}. ${FIX_IT}`).toBeUndefined();
  });

  it('every cbc:Percent element is interpolated from the threaded rate', () => {
    for (const { file, raw } of sources) {
      for (const line of raw.split('\n')) {
        if (!line.includes('cbc:Percent>')) continue;
        expect(line, `${file}: cbc:Percent is not interpolated. ${FIX_IT}`).toContain('${');
      }
    }
  });

  it('mirrors the spec DoD grep: no IGV_RATE and no 0.18 anywhere, comments included', () => {
    for (const { file, raw } of sources) {
      expect(raw, `${file}: IGV_RATE. ${FIX_IT}`).not.toMatch(/IGV_RATE/);
      // Written as `18 / 100` in prose so the statutory rate can still be
      // discussed without reintroducing the literal the proposal banned.
      expect(raw, `${file}: the literal 0.18. ${FIX_IT}`).not.toContain(`0.${18}`);
    }
  });
});
