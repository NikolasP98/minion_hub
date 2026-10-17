// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
vi.mock('$app/state', async () => ({
  page: (await import('./__fixtures__/preference-owner.svelte')).testPage,
}));
import { testPage } from './__fixtures__/preference-owner.svelte';
import { decodeDensity, density, tableDensityFor } from './density.svelte';

const data = testPage.data as { preferences?: { preferences?: Record<string, unknown> } };

beforeEach(() => {
  flushSync(() => {
    testPage.data.user.id = 'actor-a';
    testPage.data.activeOrgId = 'org-a';
    data.preferences = undefined;
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('shell density preference', () => {
  it("defaults to compact — today's shell and 44px table rows", () => {
    expect(density.mode).toBe('compact');
    expect(tableDensityFor('compact')).toBe('normal');
    expect(tableDensityFor('comfortable')).toBe('comfortable');
  });
  it('reads the SSR-loaded bundle and refuses every other shape', () => {
    flushSync(() => {
      data.preferences = { preferences: { density: { version: 1, mode: 'comfortable' } } };
    });
    expect(density.mode).toBe('comfortable');
    for (const bad of [
      undefined,
      null,
      'comfortable',
      { mode: 'comfortable' },
      { version: 2, mode: 'comfortable' },
      { version: 1, mode: 'dense' },
    ]) {
      expect(decodeDensity(bad)).toBe('compact');
    }
  });
  it('a pick wins in-session and is PUT immediately in the versioned shape', async () => {
    const fetcher = vi.fn(async () => new Response('{"ok":true}'));
    vi.stubGlobal('fetch', fetcher);
    density.set('comfortable');
    expect(density.mode).toBe('comfortable');
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/me/preferences/density');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({
      value: { version: 1, mode: 'comfortable' },
    });
  });
});
