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
import { getBranding } from '$lib/branding.svelte';
import HubWordmark from './HubWordmark.svelte';
const data = testPage.data as typeof testPage.data & { branding?: Branding };
afterEach(() => {
  cleanup();
  delete data.branding;
  vi.unstubAllGlobals();
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

it('fails closed on an unsupported client while retaining only the current organization identity', () => {
  const first = Object.freeze(
    resolveBranding({ id: 'org-a', name: 'Organization', hub_name: 'Faces' }),
  );
  const second = Object.freeze(
    resolveBranding({ id: 'org-b', name: 'Another', hub_name: 'Second' }),
  );
  expect(first).toMatchObject({ name: 'Faces', source: 'custom', readStatus: 'ready' });
  expect(second).toMatchObject({ name: 'Second', source: 'custom', readStatus: 'ready' });
  data.branding = first;
  vi.stubGlobal('Intl', Object.assign(Object.create(Intl), { Segmenter: undefined }));
  const fallback = {
    orgId: 'org-a',
    name: 'MINION',
    fullName: 'MINION Hub',
    source: 'default',
    readStatus: 'unavailable',
  };
  expect(getBranding()).toEqual(fallback);
  render(HubWordmark);
  expect(screen.getByRole('img', { name: 'MINION Hub' })).toBeTruthy();
  expect(screen.queryByRole('img', { name: 'Faces Hub' })).toBeNull();
  expect(data.branding).toStrictEqual(first);

  flushSync(() => {
    data.branding = second;
  });
  expect(getBranding()).toEqual({ ...fallback, orgId: 'org-b' });
  expect(screen.getByRole('img', { name: 'MINION Hub' })).toBeTruthy();
  expect(screen.queryByRole('img', { name: 'Second Hub' })).toBeNull();
  expect(data.branding).toStrictEqual(second);

  flushSync(() => {
    delete data.branding;
  });
  expect(getBranding()).toEqual({ ...fallback, orgId: null });
  expect(screen.getByRole('img', { name: 'MINION Hub' })).toBeTruthy();
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
    const { container } = render(HubWordmark, {
      target: host,
      props: { name: 'Clínica Faces', suffix: 'hub' },
    });
    const prefix = container.querySelector('.hub-prefix')!;
    const suffix = container.querySelector('.hub-suffix')!;
    expect(host.contains(prefix)).toBe(true);
    expect(host.contains(suffix)).toBe(true);
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
