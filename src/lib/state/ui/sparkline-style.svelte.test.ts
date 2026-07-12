import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sparklineStyle } from './sparkline-style.svelte';

describe('sparklineStyle — localStorage failure resilience', () => {
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

  it('set does not throw when localStorage.setItem throws', () => {
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
      sparklineStyle.set('bar');
    }).not.toThrow();

    // Verify state changed
    expect(sparklineStyle.current).toBe('bar');
  });

  it('applyFromServer does not throw when localStorage.setItem throws', () => {
    const mockLocalStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new DOMException('SecurityError');
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
      sparklineStyle.applyFromServer({ style: 'stepped' });
    }).not.toThrow();

    // Verify state changed
    expect(sparklineStyle.current).toBe('stepped');
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

    sparklineStyle.set('bar');

    // syncPreferenceToServer should have been called despite localStorage failure
    expect(syncPreferenceToServer).toHaveBeenCalledWith('sparklineStyle', {
      style: 'bar',
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

    sparklineStyle.set('stepped');

    expect(mockLocalStorage.setItem).toHaveBeenCalled();
    const stored = mockStorage['sparkline-style'];
    expect(stored).toBe('stepped');
  });
});
