// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compile, Polyfills } from 'tailwindcss';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import designTokens from '@minion-stack/design-tokens/contract.json';
import { ACCENT_OPTIONS, PRESETS } from '$lib/themes/presets';
import { applyTheme } from '$lib/themes/runtime';

const semanticTokens = (
  await compile(
    readFileSync(
      resolve(process.cwd(), 'node_modules/@minion-stack/design-tokens/tokens.css'),
      'utf8',
    ),
    { polyfills: Polyfills.None },
  )
).build([]);
const appStyles = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8');
let stylesheets: HTMLStyleElement[];

describe('runtime theme semantic contract', () => {
  beforeEach(() => {
    stylesheets = [semanticTokens, appStyles].map((css) => {
      const stylesheet = document.createElement('style');
      stylesheet.textContent = css;
      document.head.append(stylesheet);
      return stylesheet;
    });
    const root = document.documentElement;
    root.removeAttribute('data-minion-theme');
    root.removeAttribute('data-theme');
    root.removeAttribute('style');
  });

  afterEach(() => {
    for (const stylesheet of stylesheets) stylesheet.remove();
  });

  it('selects the shared semantic preset and keeps custom accent roles aligned', () => {
    const preset = PRESETS.find((candidate) => candidate.id === 'ayu-light');
    expect(preset).toBeDefined();

    const root = document.documentElement;
    root.style.setProperty('--color-bg', '#000001');
    root.style.setProperty('--color-border', '#000002');
    root.style.setProperty('--color-brand', '#000003');
    root.style.setProperty('--theme-radius', '99px');

    applyTheme(preset!, '#f43f5e');

    expect(root.getAttribute('data-minion-theme')).toBe('ayu-light');
    expect(root.style.getPropertyValue('--color-bg')).toBe('');
    expect(root.style.getPropertyValue('--color-border')).toBe('');
    expect(root.style.getPropertyValue('--color-brand')).toBe('');
    expect(root.style.getPropertyValue('--theme-radius')).toBe('');
    expect(root.style.getPropertyValue('--color-accent')).toBe('#f43f5e');
    expect(root.style.getPropertyValue('--color-on-accent')).toBe('#000000');
    expect(root.style.getPropertyValue('--color-accent-foreground')).toBe('');
  });

  it('resolves shared semantic styles for every Hub preset', () => {
    // The shared contract also carries consumer-specific themes (currently the
    // Site's Concourse pair). Hub's picker is intentionally a curated subset;
    // every Hub preset must exist in the contract, while additive themes for a
    // different consumer must not force a new Hub preference option.
    expect(Object.keys(designTokens.themes)).toEqual(
      expect.arrayContaining(PRESETS.map((preset) => preset.id)),
    );
    expect(new Set(PRESETS.map((preset) => preset.id)).size).toBe(PRESETS.length);
    expect(ACCENT_OPTIONS.map((accent) => accent.id).sort()).toEqual(
      Object.keys(designTokens.accentOptions).sort(),
    );
    for (const preset of PRESETS) {
      applyTheme(preset, preset.colors.accent);
      expect(
        getComputedStyle(document.documentElement).getPropertyValue('--color-canvas').trim(),
      ).toBe(designTokens.themes[preset.id].colors.canvas);
    }
  });

  it('resolves the compatibility radius from every selected semantic preset', () => {
    const root = document.documentElement;
    root.style.borderRadius = 'var(--theme-radius)';
    for (const preset of PRESETS) {
      const theme = designTokens.themes[preset.id];
      const scale = theme.radiusScale as keyof typeof designTokens.radiusScales;
      applyTheme(preset, preset.colors.accent);
      expect(getComputedStyle(root).borderRadius).toBe(designTokens.radiusScales[scale]['--radius-md']);
    }
    root.style.setProperty('--radius-md', '23px');
    expect(getComputedStyle(root).borderRadius).toBe('23px');
  });

  it.each(['clinic-light', 'clinic-dark'] as const)(
    'activates %s through the shared runtime and preserves the chosen accent',
    (id) => {
      const preset = PRESETS.find((candidate) => candidate.id === id)!;
      expect(preset).toBeDefined();
      expect(preset.mode).toBe(designTokens.themes[id].mode);
      applyTheme(preset, '#9333ea');
      expect(document.documentElement.dataset.minionTheme).toBe(id);
      expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
      expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe('#9333ea');
      expect(document.documentElement.style.getPropertyValue('--color-on-accent')).toBe('#ffffff');
    },
  );

  it('retains decorative data-theme hooks without using them as token authority', () => {
    const light = PRESETS.find((candidate) => candidate.id === 'ayu-light');
    const crt = PRESETS.find((candidate) => candidate.id === 'crt');
    expect(light).toBeDefined();
    expect(crt).toBeDefined();

    applyTheme(crt!, '#f59e0b');
    expect(document.documentElement.getAttribute('data-minion-theme')).toBe('crt');
    expect(document.documentElement.getAttribute('data-theme')).toBe('crt');
    expect(document.documentElement.style.getPropertyValue('--crt-glow-hot')).toBeTruthy();

    applyTheme(light!, '#f43f5e');
    expect(document.documentElement.getAttribute('data-minion-theme')).toBe('ayu-light');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--crt-glow-hot')).toBe('');
  });
});
