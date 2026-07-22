import { beforeEach, describe, expect, it, vi } from 'vitest';

const { replace, syncImmediately } = vi.hoisted(() => ({
  replace: vi.fn(),
  syncImmediately: vi.fn(),
}));

vi.mock('$lib/state/ui/preference-sync.svelte', () => ({
  syncPreferenceToServerImmediately: syncImmediately,
}));

vi.stubGlobal('location', {
  pathname: '/en/pos/sell',
  search: '?order=42',
  hash: '#payment',
  replace,
});
vi.stubGlobal('localStorage', {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
});

const { locale } = await import('./locale.svelte');

beforeEach(() => {
  (location as unknown as { pathname: string }).pathname = '/en/pos/sell';
  replace.mockClear();
  syncImmediately.mockClear();
});

describe('locale URL persistence', () => {
  it('replaces the current document with the new localized path', () => {
    locale.set('es');

    expect(syncImmediately).toHaveBeenCalledWith('locale', { tag: 'es' });
    expect(replace).toHaveBeenCalledWith('/es/pos/sell?order=42#payment');
  });

  it('does not navigate when the URL already carries the selected locale', () => {
    (location as unknown as { pathname: string }).pathname = '/es/pos/sell';

    locale.set('es');

    expect(replace).not.toHaveBeenCalled();
  });
});
