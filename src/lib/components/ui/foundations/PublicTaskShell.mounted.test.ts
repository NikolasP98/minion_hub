// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { createRawSnippet, flushSync } from 'svelte';
vi.mock('$app/state', async () => ({
  page: (await import('$lib/state/ui/__fixtures__/preference-owner.svelte')).testPage,
}));
import { testPage } from '$lib/state/ui/__fixtures__/preference-owner.svelte';
import { resolveBranding, type Branding } from '$lib/branding';
import PublicTaskShell from './PublicTaskShell.svelte';
const data = testPage.data as typeof testPage.data & { branding?: Branding };
afterEach(() => {
  cleanup();
  delete data.branding;
});
it('renders verified public identity as text and follows the current request projection', () => {
  data.branding = resolveBranding({ id: 'org-a', name: 'A<b>' });
  const { container } = render(PublicTaskShell, {
    eyebrow: 'Account',
    title: 'Continue',
    children: createRawSnippet(() => ({ render: () => '<p>Content</p>' })),
  });
  expect(container.querySelector('.wordmark-minion')?.textContent).toBe('A<b>');
  expect(container.querySelector('.wordmark-minion b')).toBeNull();
  expect(screen.getByRole('heading', { name: 'Continue' })).toBeTruthy();
  flushSync(() => {
    data.branding = resolveBranding(null);
  });
  expect(container.querySelector('.wordmark-minion')?.textContent).toBe('MINION');
  expect(container.querySelector('.wordmark-hub')?.textContent).toBe('Hub');
});
