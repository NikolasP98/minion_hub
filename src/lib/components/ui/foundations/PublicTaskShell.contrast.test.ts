/**
 * The public-page wordmark chip ("Minion" on the brand colour) must meet WCAG 2.2 AA
 * (4.5:1) in EVERY theme. The chip picks black or white text from the brand colour's
 * OKLCH lightness in CSS; this test reads that threshold from the component and proves
 * it against each theme in the design-token contract, so a new theme cannot break it.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const contract = JSON.parse(
  readFileSync(
    createRequire(import.meta.url).resolve('@minion-stack/design-tokens/contract.json'),
    'utf8',
  ),
) as { themes: Record<string, { colors: { brand: string } }> };
const css = readFileSync('src/lib/components/ui/foundations/PublicTaskShell.svelte', 'utf8');
const threshold = Number(
  /color: oklch\(from var\(--color-brand-pink\) clamp\(0, \(([\d.]+) - l\) \* 1000, 1\) 0 0\)/.exec(
    css,
  )?.[1],
);

const linear = (hex: string) =>
  [1, 3, 5].map((i) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
const luminance = (hex: string) => {
  const [r, g, b] = linear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const oklchLightness = (hex: string) => {
  const [r, g, b] = linear(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 0.2104542553 * l + 0.793917785 * m - 0.0040720468 * s;
};

describe('PublicTaskShell wordmark contrast', () => {
  it('reads the lightness threshold from the component', () => {
    expect(threshold).toBeGreaterThan(0);
    expect(threshold).toBeLessThan(1);
  });

  it.each(Object.entries(contract.themes))(
    '%s: chip text meets AA on the brand colour',
    (_, theme) => {
      const brand = theme.colors.brand;
      const text = oklchLightness(brand) < threshold ? '#ffffff' : '#000000';
      expect(contrast(text, brand)).toBeGreaterThanOrEqual(4.5);
    },
  );
});
