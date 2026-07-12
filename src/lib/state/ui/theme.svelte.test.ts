import { describe, it, expect, beforeEach, vi } from 'vitest';
import { theme } from './theme.svelte';

// Mock syncPreferenceToServer at the top level
vi.mock('./preference-sync.svelte', () => ({
  syncPreferenceToServer: vi.fn(),
}));

describe('theme state — localStorage failure resilience', () => {
  let originalLocalStorage: Storage | undefined;

  beforeEach(() => {
    // Store original localStorage
    originalLocalStorage = globalThis.localStorage;
  });

  afterEach(() => {
    // Restore original localStorage
    if (originalLocalStorage) {
      Object.defineProperty(globalThis, 'localStorage', {
        value: originalLocalStorage,
        writable: true,
        configurable: true,
      });
    }
    vi.restoreAllMocks();
  });

  it('setPreset does not throw when localStorage.setItem throws', () => {
    // Mock localStorage that throws on setItem
    const mockLocalStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new DOMException('QuotaExceededError');
      }),
      removeItem: vi.fn(),
      clear: vi.fn(),
      length: 0,
      key: vi.fn(() => null),
    };

    Object.defineProperty(globalThis, 'localStorage', {
      value: mockLocalStorage,
      writable: true,
      configurable: true,
    });

    // This should not throw
    expect(() => {
      theme.setPreset('obsidian');
    }).not.toThrow();

    // Verify state changed
    expect(theme.presetId).toBe('obsidian');
  });

  it('setAccent does not throw when localStorage.setItem throws', () => {
    const mockLocalStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new DOMException('QuotaExceededError');
      }),
      removeItem: vi.fn(),
      clear: vi.fn(),
      length: 0,
      key: vi.fn(() => null),
    };

    Object.defineProperty(globalThis, 'localStorage', {
      value: mockLocalStorage,
      writable: true,
      configurable: true,
    });

    expect(() => {
      theme.setAccent('purple');
    }).not.toThrow();

    expect(theme.accentId).toBe('purple');
  });

  it('syncPreferenceToServer is still called when localStorage fails', async () => {
    const { syncPreferenceToServer } = await import('./preference-sync.svelte');
    
    const mockLocalStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new DOMException('QuotaExceededError');
      }),
      removeItem: vi.fn(),
      clear: vi.fn(),
      length: 0,
      key: vi.fn(() => null),
    };

    Object.defineProperty(globalThis, 'localStorage', {
      value: mockLocalStorage,
      writable: true,
      configurable: true,
    });

    const initialPresetId = theme.presetId;
    const initialAccentId = theme.accentId;
    
    theme.setPreset('voxelized');

    // syncPreferenceToServer should have been called despite localStorage failure
    expect(syncPreferenceToServer).toHaveBeenCalledWith('theme', {
      presetId: 'voxelized',
      accentId: initialAccentId,
    });
  });

  it('normal localStorage persistence still works', () => {
    const mockStorage: Record<string, string> = {};
    const mockLocalStorage = {
      getItem: vi.fn((key: string) => mockStorage[key] || null),
      setItem: vi.fn((key: string, value: string) => {
        mockStorage[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete mockStorage[key];
      }),
      clear: vi.fn(() => {
        Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
      }),
      length: 0,
      key: vi.fn(() => null),
    };

    Object.defineProperty(globalThis, 'localStorage', {
      value: mockLocalStorage,
      writable: true,
      configurable: true,
    });

    theme.setPreset('crt');
    theme.setAccent('green');

    expect(mockLocalStorage.setItem).toHaveBeenCalled();
    const stored = JSON.parse(mockStorage['minion-hub-theme']);
    expect(stored).toEqual({
      presetId: 'crt',
      accentId: 'green',
    });
  });
});
