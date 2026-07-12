import { describe, it, expect, beforeEach, vi } from 'vitest';
import { logoState, LOGO_PRESETS } from './logo.svelte.ts';

describe('logo module localStorage error handling', () => {
  let mockLocalStorage: Storage;
  let mockConsoleError: any;

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

    mockConsoleError = console.error;
    console.error = vi.fn();
  });

  afterEach(() => {
    console.error = mockConsoleError;
  });

  it('should not throw when localStorage.setItem fails in setPreset', () => {
    mockLocalStorage.setItem = vi.fn(() => {
      throw new Error('Storage quota exceeded');
    });

    expect(() => {
      logoState.setPreset('squid');
    }).not.toThrow();

    // Verify presetId was updated despite localStorage failure
    expect(logoState.presetId).toBe('squid');
  });

  it('should not throw when localStorage.setItem fails in applyFromServer', () => {
    mockLocalStorage.setItem = vi.fn(() => {
      throw new Error('Storage disabled');
    });

    expect(() => {
      logoState.applyFromServer({ presetId: 'agent' });
    }).not.toThrow();

    // Verify presetId was updated despite localStorage failure
    expect(logoState.presetId).toBe('agent');
  });

  it('should handle localStorage.getItem failure in loadConfig silently', () => {
    mockLocalStorage.getItem = vi.fn(() => {
      throw new Error('Storage not available');
    });

    // Trigger re-initialization by reloading module
    const logoState = require('./logo.svelte.ts').logoState;
    
    // Should not throw and should return default value
    expect(logoState.presetId).toBe('minion');
  });

  it('should handle localStorage.getItem failure with invalid JSON gracefully', () => {
    mockLocalStorage.getItem = vi.fn(() => 'invalid json');

    const logoState = require('./logo.svelte.ts').logoState;
    
    // Should not throw and should return default value
    expect(logoState.presetId).toBe('minion');
  });

  it('should update favicon even when localStorage fails', () => {
    mockLocalStorage.setItem = vi.fn(() => {
      throw new Error('Storage error');
    });

    // Mock document.head and document.querySelector
    const mockLink = { 
      href: '', 
      rel: 'icon', 
      type: '',
      setAttribute: vi.fn()
    };
    const mockHead = { appendChild: vi.fn() };
    const mockDocument = {
      head: mockHead,
      querySelector: vi.fn(() => null),
      createElement: vi.fn(() => mockLink)
    };

    Object.defineProperty(window, 'document', {
      value: mockDocument,
      writable: true,
    });

    expect(() => {
      logoState.setPreset('orbital');
    }).not.toThrow();

    expect(logoState.presetId).toBe('orbital');
  });

  it('should return SVG content for all presets', () => {
    for (const preset of LOGO_PRESETS) {
      const svg = logoState.getSvgForPreset(preset.id);
      expect(svg).toBeTruthy();
      expect(svg).toContain('<svg');
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    }
  });
});