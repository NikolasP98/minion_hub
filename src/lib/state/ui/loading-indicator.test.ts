// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
vi.mock('$app/state', async () => ({
  page: (await import('./__fixtures__/preference-owner.svelte')).testPage,
}));
import { testPage } from './__fixtures__/preference-owner.svelte';
import { decodeLoadingIndicator, loadingIndicator } from './loading-indicator.svelte';

const data = testPage.data as { preferences?: { preferences?: Record<string, unknown> } };

beforeEach(() => {
  flushSync(() => {
    testPage.data.user.id = 'actor-a';
    testPage.data.activeOrgId = 'org-a';
    data.preferences = undefined;
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('loading indicator placement preference', () => {
  it('defaults to icon-ring', () => {
    expect(loadingIndicator.placement).toBe('icon-ring');
  });
  it('reads the SSR-loaded bundle and refuses every other shape', () => {
    flushSync(() => {
      data.preferences = {
        preferences: { loadingIndicator: { version: 1, placement: 'divider-bar' } },
      };
    });
    expect(loadingIndicator.placement).toBe('divider-bar');
    for (const bad of [
      undefined,
      null,
      'divider-bar',
      { placement: 'divider-bar' },
      { version: 2, placement: 'divider-bar' },
      { version: 1, placement: 'footer' },
    ]) {
      expect(decodeLoadingIndicator(bad)).toBe('icon-ring');
    }
  });
  it('a pick wins in-session and is PUT immediately in the versioned shape', async () => {
    const fetcher = vi.fn(async () => new Response('{"ok":true}'));
    vi.stubGlobal('fetch', fetcher);
    loadingIndicator.set('divider-bar');
    expect(loadingIndicator.placement).toBe('divider-bar');
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/me/preferences/loadingIndicator');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({
      value: { version: 1, placement: 'divider-bar' },
    });
  });
});
