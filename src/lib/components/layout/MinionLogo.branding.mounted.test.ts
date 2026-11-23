// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { compile } from 'svelte/compiler';
import { compile as compileTailwind } from 'tailwindcss';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('$app/state', async () => ({
  page: (await import('$lib/state/ui/__fixtures__/preference-owner.svelte')).testPage,
}));
import { testPage } from '$lib/state/ui/__fixtures__/preference-owner.svelte';
import { resolveBranding, type Branding } from '$lib/branding';
import { LOGO_PRESETS } from '$lib/state/ui/logo.svelte';
import MinionLogo from './MinionLogo.svelte';
import HubWordmark from './HubWordmark.svelte';

const data = testPage.data as typeof testPage.data & { branding?: Branding };
let host: HTMLDivElement;
let stylesheet: HTMLStyleElement;
const defaultPreset = LOGO_PRESETS.find((preset) => preset.id === 'minion')!;
const agentPreset = LOGO_PRESETS.find((preset) => preset.id === 'agent')!;

function computedColor(value: string) {
  const probe = document.createElement('span');
  probe.style.color = value;
  host.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

/** happy-dom returns the explicit CSS-wide keyword instead of resolving it.
 * Follow the actual computed ancestor chain for these inherited properties. */
function inheritedPresentation(element: Element, property: 'color' | 'fontWeight'): string {
  const value = getComputedStyle(element)[property];
  if (value !== 'inherit') return value;
  if (!element.parentElement) throw new Error('Missing inheritance ancestor');
  return inheritedPresentation(element.parentElement, property);
}

beforeEach(async () => {
  data.branding = resolveBranding({ id: 'org-a', name: 'Clínica Faces' });
  // Vitest omits component styles. Attach the real compiler-emitted CSS so
  // child selectors, parent inheritance and custom-property colors participate.
  const filename = resolve('src/lib/components/layout/HubWordmark.svelte');
  const compiled = compile(readFileSync(filename, 'utf8'), {
    filename,
    generate: 'client',
    css: 'external',
  });
  stylesheet = document.createElement('style');
  // Produce font-black from the same installed Tailwind theme the app consumes,
  // rather than hard-coding a lookalike class in the test.
  const typography = await compileTailwind(
    `${readFileSync(resolve('node_modules/tailwindcss/theme.css'), 'utf8')}\n@tailwind utilities;`,
  );
  // happy-dom drops :root, :host and the rule after an empty @layer statement.
  // These light-DOM equivalents preserve the real generated declarations.
  const typographyCss = typography
    .build(['font-black'])
    .replace('@layer properties;', '')
    .replaceAll(':root, :host', ':root');
  stylesheet.textContent = `${typographyCss}\n${compiled.css?.code ?? ''}`;
  document.head.append(stylesheet);
  host = document.createElement('div');
  host.style.setProperty('--color-brand-pink', defaultPreset.secondaryColor);
  host.style.setProperty('--color-text-primary', agentPreset.primaryColor);
  const contract = JSON.parse(
    readFileSync(resolve('node_modules/@minion-stack/design-tokens/contract.json'), 'utf8'),
  ) as { foundations: { fontWeights: Record<string, string> } };
  for (const [name, value] of Object.entries(contract.foundations.fontWeights))
    host.style.setProperty(name, value);
  host.style.color = agentPreset.primaryColor;
  host.style.textTransform = 'uppercase';
  document.body.append(host);
});

afterEach(() => {
  cleanup();
  stylesheet.remove();
  host.remove();
  delete data.branding;
});

describe('MinionLogo preserves its personal preset text palette', () => {
  it.each(LOGO_PRESETS)('uses the $id preset color for the actual branded prefix', (preset) => {
    const { container } = render(MinionLogo, {
      target: host,
      props: { preset: preset.id, showText: true },
    });
    const prefix = container.querySelector<HTMLElement>('.hub-prefix')!;
    const suffix = container.querySelector<HTMLElement>('.hub-suffix')!;
    const textWrapper = prefix.closest('.hub-wordmark')!.parentElement!;
    const expected = computedColor(preset.secondaryColor);
    expect(getComputedStyle(host).color).not.toBe(expected);
    expect(inheritedPresentation(prefix, 'color')).toBe(expected);
    expect(getComputedStyle(textWrapper).color).toBe(expected);
    expect(getComputedStyle(textWrapper).fontWeight).toBe('900');
    expect(inheritedPresentation(prefix, 'fontWeight')).toBe('900');
    expect(getComputedStyle(suffix).fontWeight).toBe('600');
    expect(getComputedStyle(suffix).color).toBe(computedColor(agentPreset.primaryColor));
    expect(prefix.textContent).toBe('Clínica Faces');
    expect(getComputedStyle(prefix).textTransform).toBe('none');
    expect(suffix.textContent).toBe('hub');
  });

  it('reacts to preset and organization replacement without replacing the fixed suffix palette', async () => {
    const view = render(MinionLogo, {
      target: host,
      props: { preset: 'agent', showText: true },
    });
    expect(inheritedPresentation(host.querySelector('.hub-prefix')!, 'color')).toBe(
      computedColor(agentPreset.secondaryColor),
    );
    await view.rerender({ preset: 'orbital', showText: true });
    const orbital = LOGO_PRESETS.find((preset) => preset.id === 'orbital')!;
    expect(inheritedPresentation(host.querySelector('.hub-prefix')!, 'color')).toBe(
      computedColor(orbital.secondaryColor),
    );
    flushSync(() => {
      data.branding = resolveBranding({ id: 'org-b', name: 'Orbit' });
    });
    expect(host.querySelector('.hub-prefix')?.textContent).toBe('Orbit');
    expect(inheritedPresentation(host.querySelector('.hub-prefix')!, 'color')).toBe(
      computedColor(orbital.secondaryColor),
    );
    expect(getComputedStyle(host.querySelector('.hub-suffix')!).color).toBe(
      computedColor(agentPreset.primaryColor),
    );
  });

  it('retains the default brand-pink prefix for ordinary shell wordmarks', () => {
    host.style.color = agentPreset.secondaryColor;
    host.style.fontWeight = '600';
    const { container } = render(HubWordmark, { target: host, props: {} });
    expect(getComputedStyle(container.querySelector('.hub-prefix')!).color).toBe(
      computedColor(defaultPreset.secondaryColor),
    );
    expect(getComputedStyle(container.querySelector('.hub-suffix')!).color).toBe(
      computedColor(agentPreset.primaryColor),
    );
    expect(getComputedStyle(container.querySelector('.hub-prefix')!).fontWeight).toBe('700');
    expect(getComputedStyle(container.querySelector('.hub-suffix')!).fontWeight).toBe('600');
  });

  it('keeps the existing icon-only default', () => {
    const { container } = render(MinionLogo, { target: host, props: { preset: 'agent' } });
    expect(container.querySelector('.hub-wordmark')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
