/**
 * HC-043 — resolved mention foreground must clear WCAG AA (4.5:1, body text) on
 * every surface it can render on, for every supported preset × runtime accent,
 * measured with valid CSS colour conversion (Oklab → sRGB, sRGB alpha compositing).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { composite, contrast, OKLAB_SELF_CHECK, parseCssColor, toHex } from './css-color';
import {
  CHAT_MESSAGE,
  KNOWN_SURFACE_TEXT_GAPS,
  measureAll,
  ruleDeclarations,
  SURFACES,
} from './resolve';

describe('css-color conversion validity', () => {
  it('converts the Chromium-reported oklab() of shipped tokens back to their hex', () => {
    const dark = parseCssColor(OKLAB_SELF_CHECK.input);
    expect(toHex([dark[0], dark[1], dark[2]])).toBe(OKLAB_SELF_CHECK.expectedOpaqueHex); // new-york --color-danger-fg
    expect(dark[3]).toBeCloseTo(0.15, 6);
    const light = parseCssColor('oklab(0.443694 0.14388 0.0729957 / 0.15)');
    expect(toHex([light[0], light[1], light[2]])).toBe('#991b1b'); // github-light --color-danger-fg
  });

  it('parses the other syntaxes Chromium and tokens.css emit', () => {
    expect(parseCssColor('rgba(0, 0, 0, 0)')).toEqual([0, 0, 0, 0]);
    expect(parseCssColor('rgb(24, 24, 27)')).toEqual([24, 24, 27, 1]);
    expect(parseCssColor('rgba(255, 255, 255, 0.06)')[3]).toBeCloseTo(0.06);
    expect(parseCssColor('color(srgb 1 0 0 / 0.5)')).toEqual([255, 0, 0, 0.5]);
    const lch = parseCssColor('oklch(0.80769 0.1035 19.6)'); // ≈ the same #fca5a5 in polar form
    expect(Math.abs(lch[0] - 252)).toBeLessThan(2);
    expect(() => parseCssColor('hwb(0 0% 0%)')).toThrow(/unsupported/);
  });

  it('rejects the historical unconverted-oklab error-surface background', () => {
    // mention-other-surfaces-contrast-v1.json composited new-york's error bubble as
    // (20.52, 20.41, 22.96) because its parser read `oklab(0.80769 …)` as near-zero RGB.
    const invalidClaim: [number, number, number] = [20.521153499999997, 20.41463124, 22.9552023];
    const valid = composite([
      parseCssColor(OKLAB_SELF_CHECK.input),
      [24, 24, 27, 1],
      [9, 9, 11, 1],
    ]);
    expect(valid.map((v) => Math.round(v))).toEqual([58, 45, 48]);
    expect(Math.abs(valid[0] - invalidClaim[0])).toBeGreaterThan(30);
    // and the ratio that receipt derived from it (3.54:1) is not reproducible from valid data
    expect(contrast([37, 99, 235], valid)).toBeLessThan(3);
  });

  it('agrees with the hub contrast helper on an opaque pair', () => {
    expect(contrast([37, 99, 235], [255, 255, 255])).toBeCloseTo(5.17, 2); // blue accent on white
  });
});

describe('resolved .mention contrast (shipped app.css × tokens.css × runtime accents)', () => {
  const rows = measureAll();

  it('measures every supported preset, every runtime accent and every surface', () => {
    expect(new Set(rows.map((r) => r.theme)).size).toBe(16);
    expect(new Set(rows.map((r) => r.accent)).size).toBe(11); // theme default + 10 runtime options
    expect(new Set(rows.map((r) => r.surface))).toEqual(new Set(SURFACES));
  });

  for (const surface of SURFACES) {
    it(`${surface} surface clears 4.5:1 on every theme × accent × host`, () => {
      const failing = rows
        .filter((r) => r.surface === surface && r.ratio < 4.5)
        .filter((r) => !KNOWN_SURFACE_TEXT_GAPS.has(`${r.theme}|${r.surface}|${r.host}`))
        .sort((a, b) => a.ratio - b.ratio)
        .slice(0, 8)
        .map(
          (r) =>
            `${r.theme}/${r.accent}/${r.host}: ${r.fg} on ${r.bg} = ${r.ratio.toFixed(2)}:1 (${r.fgSource})`,
        );
      expect(failing, `worst ${surface} pairs:\n${failing.join('\n')}`).toEqual([]);
    });
  }

  it('never reads worse than the surface text it sits on, and the known gaps are only surface-text gaps', () => {
    for (const r of rows)
      expect(r.ratio, `${r.theme}/${r.accent}/${r.surface}/${r.host}`).toBeGreaterThanOrEqual(
        r.surfaceTextRatio - 1e-9,
      );
    const gaps = new Set(
      rows.filter((r) => r.ratio < 4.5).map((r) => `${r.theme}|${r.surface}|${r.host}`),
    );
    expect(gaps).toEqual(KNOWN_SURFACE_TEXT_GAPS); // flips when a gap is fixed upstream — then drop it from the set
    for (const r of rows.filter((r) => gaps.has(`${r.theme}|${r.surface}|${r.host}`)))
      expect(r.surfaceTextRatio).toBeLessThan(4.5);
  });

  it('keeps the accepted user-bubble identity: on-accent foreground + underline', () => {
    for (const r of rows.filter((r) => r.surface === 'user')) {
      expect(r.fgSource).toMatch(/surface text/); // inherits the bubble's --color-on-accent
    }
    const chat = readFileSync(CHAT_MESSAGE, 'utf8');
    const app = readFileSync(new URL('../../../src/app.css', import.meta.url), 'utf8');
    const scoped = ruleDeclarations(chat, '.chat-user-message :global(.mention)');
    const global = ruleDeclarations(app, '.mention');
    const effective = { ...global, ...scoped };
    expect(effective['text-decoration']).toContain('underline');
    expect(effective['font-weight']).toBe('600');
  });
});
