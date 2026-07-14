// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import designTokens from '@minion-stack/design-tokens/contract.json';
import { ACCENT_OPTIONS, PRESETS } from '$lib/themes/presets';
import { applyTheme } from '$lib/themes/runtime';

const semanticTokens = readFileSync(
  resolve(process.cwd(), 'node_modules/@minion-stack/design-tokens/tokens.css'),
  'utf8',
);
const appStyles = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8');

describe('runtime theme semantic contract', () => {
  beforeEach(() => {
    const root = document.documentElement;
    root.removeAttribute('data-minion-theme');
    root.removeAttribute('data-theme');
    root.removeAttribute('style');
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

  it('has one shared semantic selector for every non-default Hub preset', () => {
    expect(PRESETS.map((preset) => preset.id).sort()).toEqual(
      Object.keys(designTokens.themes).sort(),
    );
    expect(ACCENT_OPTIONS.map((accent) => accent.id).sort()).toEqual(
      Object.keys(designTokens.accentOptions).sort(),
    );
    for (const preset of PRESETS) {
      if (preset.id === 'new-york') continue;
      expect(semanticTokens).toContain(`data-minion-theme='${preset.id}'`);
    }
    expect(appStyles).toContain('--theme-radius: var(--radius-md)');
  });

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
