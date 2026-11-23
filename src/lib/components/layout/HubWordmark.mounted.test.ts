// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { compile } from 'svelte/compiler';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
vi.mock('$app/state', async () => ({
  page: (await import('$lib/state/ui/__fixtures__/preference-owner.svelte')).testPage,
}));
import { testPage } from '$lib/state/ui/__fixtures__/preference-owner.svelte';
import { resolveBranding, type Branding } from '$lib/branding';
import HubWordmark from './HubWordmark.svelte';
const data = testPage.data as typeof testPage.data & { branding?: Branding };
afterEach(() => {
  cleanup();
  delete data.branding;
});
it.each(['WWWWWWWWWWWWWWW', '漢字漢字漢字漢字漢字漢字漢字漢', 'École Faces', '👩🏽‍💻'.repeat(15)])(
  'renders the complete bounded identity %s and fixed suffix',
  (name) => {
    data.branding = resolveBranding({ id: 'org-a', name: 'Organization', hub_name: name });
    render(HubWordmark);
    expect(screen.getByRole('img', { name: `${name} Hub` })).toBeTruthy();
    expect(screen.getByText(name).textContent).toBe(name);
    expect(screen.getByText('hub')).toBeTruthy();
  },
);
it('follows replacement page data without retaining the prior organization', () => {
  data.branding = resolveBranding({ id: 'org-a', name: 'Faces' });
  render(HubWordmark);
  expect(screen.getByRole('img', { name: 'Faces Hub' })).toBeTruthy();
  flushSync(() => {
    data.branding = resolveBranding({ id: 'org-b', name: 'Second' });
  });
  expect(screen.queryByRole('img', { name: 'Faces Hub' })).toBeNull();
  expect(screen.getByRole('img', { name: 'Second Hub' })).toBeTruthy();
});

it('preserves custom case and the explicit shell suffix under an uppercase typography ancestor', () => {
  // Vitest does not attach component styles. Apply the actual compiler-emitted CSS
  // so this regression checks computed presentation rather than textContent alone.
  const filename = resolve('src/lib/components/layout/HubWordmark.svelte');
  const compiled = compile(readFileSync(filename, 'utf8'), {
    filename,
    generate: 'client',
    css: 'external',
  });
  const style = document.createElement('style');
  style.textContent = compiled.css?.code ?? '';
  document.head.append(style);
  const host = document.createElement('div');
  host.style.textTransform = 'uppercase';
  document.body.append(host);
  try {
    const { container } = render(
      HubWordmark,
      { name: 'Clínica Faces', suffix: 'hub' },
      { container: host },
    );
    const prefix = container.querySelector('.hub-prefix')!;
    const suffix = container.querySelector('.hub-suffix')!;
    expect(getComputedStyle(host).textTransform).toBe('uppercase');
    expect(getComputedStyle(prefix).textTransform).toBe('none');
    expect(getComputedStyle(suffix).textTransform).toBe('none');
    expect(prefix.textContent).toBe('Clínica Faces');
    expect(suffix.textContent).toBe('hub');
  } finally {
    style.remove();
    host.remove();
  }
});
