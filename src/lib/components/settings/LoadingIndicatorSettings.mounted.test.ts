// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
vi.mock('$app/state', async () => ({
  page: (await import('$lib/state/ui/__fixtures__/preference-owner.svelte')).testPage,
}));
import LoadingIndicatorSettings from './LoadingIndicatorSettings.svelte';
import { loadingIndicator } from '$lib/state/ui/loading-indicator.svelte';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('LoadingIndicatorSettings', () => {
  it('shows the section icon as default and round-trips a pick through the preference', async () => {
    const fetcher = vi.fn(async () => new Response('{"ok":true}'));
    vi.stubGlobal('fetch', fetcher);
    render(LoadingIndicatorSettings);
    expect(screen.getByRole('group', { name: 'Loading indicator' })).toBeTruthy();
    const icon = screen.getByRole('button', { name: 'Section icon' });
    const divider = screen.getByRole('button', { name: 'Header divider' });
    expect(icon.getAttribute('aria-pressed')).toBe('true');
    expect(loadingIndicator.placement).toBe('icon-ring');

    await fireEvent.click(divider);
    expect(loadingIndicator.placement).toBe('divider-bar');
    expect(divider.getAttribute('aria-pressed')).toBe('true');
    expect(icon.getAttribute('aria-pressed')).toBe('false');
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/me/preferences/loadingIndicator');
    expect(JSON.parse(init.body as string)).toEqual({
      value: { version: 1, placement: 'divider-bar' },
    });
  });
});
