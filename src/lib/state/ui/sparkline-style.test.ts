import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sparklineStyle, SPARKLINE_STYLE_OPTIONS } from './sparkline-style.svelte.ts';

describe('sparklineStyle module localStorage error handling', () => {
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

  it('should not throw when localStorage.setItem fails in setter', () => {
    mockLocalStorage.setItem = vi.fn(() => {
      throw new Error('Storage quota exceeded');
    });

    expect(() => {
      sparklineStyle.current = 'bar';
    }).not.toThrow();

    // Verify current style was updated despite localStorage failure
    expect(sparklineStyle.current).toBe('bar');
  });

  it('should not throw when localStorage.setItem fails in applyFromServer', () => {
    mockLocalStorage.setItem = vi.fn(() => {
      throw new Error('Storage disabled');
    });

    expect(() => {
      sparklineStyle.applyFromServer({ style: 'stepped' });
    }).not.toThrow();

    // Verify current style was updated despite localStorage failure
    expect(sparklineStyle.current).toBe('stepped');
  });

  it('should handle localStorage.getItem failure in loadStyle silently', () => {
    mockLocalStorage.getItem = vi.fn(() => {
      throw new Error('Storage not available');
    });

    // Trigger re-initialization by reloading module
    const sparklineStyle = require('./sparkline-style.svelte.ts').sparklineStyle;
    
    // Should not throw and should return default value
    expect(sparklineStyle.current).toBe('area');
  });

  it('should ignore invalid stored values and return default', () => {
    // Simulate invalid stored value
    mockLocalStorage.getItem = vi.fn(() => 'invalid-style');

    const sparklineStyle = require('./sparkline-style.svelte.ts').sparklineStyle;
    
    // Should return default value
    expect(sparklineStyle.current).toBe('area');
  });

  it('should correctly handle all valid style values', () => {
    const validStyles = ['area', 'bar', 'stepped'];
    
    for (const style of validStyles) {
      sparklineStyle.current = style;
      expect(sparklineStyle.current).toBe(style);
    }
  });

  it('should ignore invalid style values in applyFromServer', () => {
    const originalStyle = sparklineStyle.current;
    
    // Try to apply invalid style
    sparklineStyle.applyFromServer({ style: 'invalid-style' });
    
    // Should not change
    expect(sparklineStyle.current).toBe(originalStyle);
  });

  it('should maintain type safety for style options', () => {
    // Verify SPARKLINE_STYLE_OPTIONS contains all valid styles
    const validStyles = ['area', 'bar', 'stepped'];
    
    expect(SPARKLINE_STYLE_OPTIONS).toHaveLength(3);
    SPARKLINE_STYLE_OPTIONS.forEach(option => {
      expect(validStyles).toContain(option.id);
      expect(option.label).toBeTruthy();
      expect(option.icon).toBeTruthy();
    });
  });
});