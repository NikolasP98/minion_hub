// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock $app/state so importing preference-sync.svelte (a transitive import of
// logo.svelte) doesn't require the SvelteKit runtime.
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

describe('logo.svelte setPreset — best-effort persistence', () => {
  it('updates in-memory state and calls syncPreferenceToServer when localStorage.setItem throws', async () => {
    const setItemSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('QuotaExceededError');
      });

    const { logoState } = await import('./logo.svelte');

    expect(() => logoState.setPreset('agent')).not.toThrow();
    expect(logoState.presetId).toBe('agent');
    expect(syncPreferenceToServer).toHaveBeenCalledWith('logo', { presetId: 'agent' });

    setItemSpy.mockRestore();
  });

  it('still persists to localStorage and syncs when storage is available', async () => {
    const { logoState } = await import('./logo.svelte');

    logoState.setPreset('hex');

    expect(localStorage.getItem('minion-hub-logo')).toBe(JSON.stringify({ presetId: 'hex' }));
    expect(syncPreferenceToServer).toHaveBeenCalledWith('logo', { presetId: 'hex' });
  });
});
