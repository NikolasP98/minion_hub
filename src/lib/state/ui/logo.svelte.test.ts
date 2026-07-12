import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { logoState } from './logo.svelte';

describe('logoState — localStorage failure resilience', () => {
  let originalLocalStorage: Storage | undefined;

  beforeEach(() => {
    // Store original localStorage
    originalLocalStorage = globalThis.localStorage;
    
    // Mock syncPreferenceToServer
    vi.mock('./preference-sync.svelte', () => ({
      syncPreferenceToServer: vi.fn(),
    }));
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
      logoState.setPreset('squid');
    }).not.toThrow();

    // Verify state changed
    expect(logoState.presetId).toBe('squid');
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

    logoState.setPreset('agent');

    // syncPreferenceToServer should have been called despite localStorage failure
    expect(syncPreferenceToServer).toHaveBeenCalledWith('logo', {
      presetId: 'agent',
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

    logoState.setPreset('orbital');

    expect(mockLocalStorage.setItem).toHaveBeenCalled();
    const stored = JSON.parse(mockStorage['minion-hub-logo']);
    expect(stored).toEqual({
      presetId: 'orbital',
    });
  });
});
