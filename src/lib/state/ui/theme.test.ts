import { describe, it, expect, beforeEach, vi } from 'vitest';
import { theme } from './theme.svelte.ts';

describe('theme module localStorage error handling', () => {
  let mockLocalStorage: Storage;

  beforeEach(() => {
    mockLocalStorage = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      length: 0,
      key: vi.fn(),
    };

    // Mock localStorage for tests
    Object.defineProperty(window, 'localStorage', {
      value: mockLocalStorage,
      writable: true,
    });
  });

  it('should not throw when localStorage.setItem fails in setPreset', () => {
    mockLocalStorage.setItem = vi.fn(() => {
      throw new Error('Storage quota exceeded');
    });

    const originalConsoleError = console.error;
    console.error = vi.fn();

    expect(() => {
      theme.setPreset('voxelized');
    }).not.toThrow();

    // Verify presetId was updated despite localStorage failure
    expect(theme.presetId).toBe('voxelized');
    
    console.error = originalConsoleError;
  });

  it('should not throw when localStorage.setItem fails in setAccent', () => {
    mockLocalStorage.setItem = vi.fn(() => {
      throw new Error('Storage disabled');
    });

    const originalConsoleError = console.error;
    console.error = vi.fn();

    expect(() => {
      theme.setAccent('purple');
    }).not.toThrow();

    // Verify accentId was updated despite localStorage failure
    expect(theme.accentId).toBe('purple');
    
    console.error = originalConsoleError;
  });

  it('should handle localStorage.setItem failure in applyFromServer', () => {
    mockLocalStorage.setItem = vi.fn(() => {
      throw new Error('Security error');
    });

    const originalConsoleError = console.error;
    console.error = vi.fn();

    expect(() => {
      theme.applyFromServer({ presetId: 'obsidian', accentId: 'green' });
    }).not.toThrow();

    // Verify values were updated despite localStorage failure
    expect(theme.presetId).toBe('obsidian');
    expect(theme.accentId).toBe('green');
    
    console.error = originalConsoleError;
  });

  it('should handle localStorage.getItem failure in loadConfig silently', () => {
    mockLocalStorage.getItem = vi.fn(() => {
      throw new Error('Storage not available');
    });

    // Create a new instance to test loadConfig directly
    const theme = require('./theme.svelte.ts').theme;
    
    // Should not throw and should return default values
    expect(theme.presetId).toBe('new-york');
    expect(theme.accentId).toBe('blue');
  });

  it('should handle localStorage.getItem failure with invalid JSON gracefully', () => {
    mockLocalStorage.getItem = vi.fn(() => 'invalid json');

    const theme = require('./theme.svelte.ts').theme;
    
    // Should not throw and should return default values
    expect(theme.presetId).toBe('new-york');
    expect(theme.accentId).toBe('blue');
  });
});