// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
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
