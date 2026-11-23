// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { page } from '$app/state';
import { resolveBranding, type Branding } from '$lib/branding';

vi.mock('$lib/state/ui/preference-sync.svelte', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/state/ui/preference-sync.svelte')>()),
  syncPreferenceToServer: vi.fn(),
}));

import { crtConfig } from '$lib/state/ui/crt-config.svelte';
import CRTConfigModal from './CRTConfigModal.svelte';

const data = page.data as { branding?: Branding };

beforeEach(() => {
  crtConfig.applyFromServer({});
  data.branding = resolveBranding({ id: 'org-a', name: 'Clínica Faces' });
});
afterEach(() => {
  cleanup();
  crtConfig.cleanup();
  delete data.branding;
  vi.restoreAllMocks();
});

it('opens the actual modal, applies one change once, and reloads stored settings on reopening without a feedback loop', async () => {
  const realSet = crtConfig.set;
  let writes = 0;
  // Bound a regression before its feedback loop can starve the test runner.
  const set = vi.spyOn(crtConfig, 'set').mockImplementation((updates) => {
    if (++writes > 5) throw new Error('CRT modal repeatedly wrote without a user change');
    realSet(updates);
  });
  const apply = vi.spyOn(crtConfig, 'apply');
  const view = render(CRTConfigModal, { props: { open: false } });
  expect(set).not.toHaveBeenCalled();
  expect(apply).not.toHaveBeenCalled();

  await view.rerender({ open: true });
  const dialog = screen.getByRole('dialog', { name: 'CRT Effects' }) as HTMLDialogElement;
  expect(dialog.open).toBe(true);
  expect(screen.getByText('[Clínica Faces]')).toBeTruthy();
  expect(set).toHaveBeenCalledTimes(1);
  expect(apply).toHaveBeenCalledTimes(1);

  await fireEvent.click(screen.getByRole('button', { name: 'Deep' }));
  expect(crtConfig.bloom).toBe('deep');
  expect(document.documentElement.dataset.crtBloom).toBe('deep');
  expect(set).toHaveBeenCalledTimes(2);
  expect(apply).toHaveBeenCalledTimes(2);
  await tick();
  flushSync();
  expect(apply).toHaveBeenCalledTimes(2);

  await fireEvent.click(screen.getAllByRole('button', { name: 'Close' }).at(-1)!);
  // happy-dom does not run CSS animations; finish the actual Dialog content's
  // exit animation at the same DOM boundary its native handler listens to.
  await fireEvent.animationEnd(dialog.querySelector('[data-part="content"]')!);
  await waitFor(() => expect(dialog.open).toBe(false));
  expect(apply).toHaveBeenCalledTimes(2);
  await view.rerender({ open: false });

  // A later stored preference must seed the next open, without making a closed
  // modal write or applying the previous local draft over that preference.
  crtConfig.applyFromServer({ bloom: 'halation', scan: 'off' });
  await tick();
  expect(set).toHaveBeenCalledTimes(2);
  expect(apply).toHaveBeenCalledTimes(2);
  await view.rerender({ open: true });
  expect(dialog.open).toBe(true);
  expect(screen.getByRole('button', { name: 'Halo' }).getAttribute('aria-pressed')).toBe('true');
  expect(crtConfig.bloom).toBe('halation');
  expect(crtConfig.scan).toBe('off');
  expect(document.documentElement.dataset.crtBloom).toBe('halation');
  expect(document.documentElement.dataset.crtScan).toBe('off');
  expect(set).toHaveBeenCalledTimes(3);
  expect(apply).toHaveBeenCalledTimes(3);
});
