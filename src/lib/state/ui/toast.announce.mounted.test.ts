// @vitest-environment happy-dom
/**
 * Spec 155 PR B — a toast is spoken through the shared announcer, so it is heard even when
 * it fires before the (deferred) Toaster component has mounted, and an error interrupts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toastAsync, toastError, toastSuccess, toaster } from './toast.svelte';

const said = (politeness: 'polite' | 'assertive') =>
  document.querySelector(`[data-announcer="${politeness}"]`)?.textContent ?? '';
const spoken = (politeness: 'polite' | 'assertive', text: string) =>
  vi.waitFor(() => expect(said(politeness)).toBe(text));

afterEach(() => {
  for (const el of document.querySelectorAll('[data-announcer]')) el.textContent = '';
});

describe('toasts are announced', () => {
  it('with no Toaster mounted: a success politely, an error assertively', async () => {
    expect(document.querySelector('[data-part="group"]')).toBeNull(); // nothing mounted
    toastSuccess('Saved', 'Three rows');
    await spoken('polite', 'Saved. Three rows');
    toastError('Could not save');
    await spoken('assertive', 'Could not save');
  });

  it('a toast created straight on the store is announced too', async () => {
    toaster.create({ title: 'Restarting', type: 'info' });
    await spoken('polite', 'Restarting');
  });

  it('a loading toast announces its outcome when it updates', async () => {
    const done = toastAsync(Promise.resolve('ok'), {
      loading: 'Probing',
      getOutcome: () => ({ type: 'error', title: 'Probe failed' }),
    });
    await spoken('polite', 'Probing');
    await done;
    await spoken('assertive', 'Probe failed');
  });
});
