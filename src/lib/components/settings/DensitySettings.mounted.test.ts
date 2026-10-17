// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
vi.mock('$app/state', async () => ({
  page: (await import('$lib/state/ui/__fixtures__/preference-owner.svelte')).testPage,
}));
import DensitySettings from './DensitySettings.svelte';
import { density } from '$lib/state/ui/density.svelte';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('DensitySettings', () => {
  it('shows compact as the default and round-trips a pick through the preference', async () => {
    const fetcher = vi.fn(async () => new Response('{"ok":true}'));
    vi.stubGlobal('fetch', fetcher);
    render(DensitySettings);
    const group = screen.getByRole('group', { name: 'Density' });
    const compact = screen.getByRole('button', { name: 'Compact (default)' });
    const comfortable = screen.getByRole('button', { name: 'Comfortable' });
    expect(group).toBeTruthy();
    expect(compact.getAttribute('aria-pressed')).toBe('true');
    expect(density.mode).toBe('compact');

    await fireEvent.click(comfortable);
    expect(density.mode).toBe('comfortable');
    expect(comfortable.getAttribute('aria-pressed')).toBe('true');
    expect(compact.getAttribute('aria-pressed')).toBe('false');
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/me/preferences/density');
    expect(JSON.parse(init.body as string)).toEqual({ value: { version: 1, mode: 'comfortable' } });
  });
});
