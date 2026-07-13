// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock $app/state so importing preference-sync.svelte (a transitive import of
// theme.svelte) doesn't require the SvelteKit runtime.
vi.mock('$app/state', () => ({
  page: { data: {} },
}));

// Mock user state so syncPreferenceToServer's guard is deterministic and no
// network fetch is attempted.
vi.mock('$lib/state/features/user.svelte', () => ({
  userState: { user: null },
}));

const syncPreferenceToServer = vi.fn();
vi.mock('./preference-sync.svelte', () => ({
  syncPreferenceToServer: (...args: unknown[]) => syncPreferenceToServer(...args),
}));

beforeEach(() => {
  syncPreferenceToServer.mockClear();
  localStorage.clear();
});

describe('theme.svelte setPreset/setAccent — best-effort persistence', () => {
  it('updates in-memory state and calls syncPreferenceToServer when localStorage.setItem throws', async () => {
    const setItemSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('QuotaExceededError');
      });

    const { theme } = await import('./theme.svelte');

    expect(() => theme.setPreset('cyberpunk')).not.toThrow();
    expect(theme.presetId).toBe('cyberpunk');
    expect(syncPreferenceToServer).toHaveBeenCalledWith('theme', {
      presetId: 'cyberpunk',
      accentId: theme.accentId,
    });

    syncPreferenceToServer.mockClear();

    expect(() => theme.setAccent('purple')).not.toThrow();
    expect(theme.accentId).toBe('purple');
    expect(syncPreferenceToServer).toHaveBeenCalledWith('theme', {
      presetId: 'cyberpunk',
      accentId: 'purple',
    });

    setItemSpy.mockRestore();
  });

  it('still persists to localStorage and syncs when storage is available', async () => {
    const { theme } = await import('./theme.svelte');

    theme.setPreset('void');

    expect(localStorage.getItem('minion-hub-theme')).toBe(
      JSON.stringify({ presetId: 'void', accentId: theme.accentId }),
    );
    expect(syncPreferenceToServer).toHaveBeenCalledWith('theme', {
      presetId: 'void',
      accentId: theme.accentId,
    });
  });
});
