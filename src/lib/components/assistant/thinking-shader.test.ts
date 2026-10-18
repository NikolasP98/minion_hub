import { describe, expect, test } from 'vitest';
import { ACCENT_OPTIONS } from '$lib/themes/presets';
import {
  DEFAULT_THINKING_STYLE,
  THINKING_STYLES,
  hexToRgb,
  isThinkingStyle,
  thinkingFragment,
} from './thinking-shader';

describe('thinking shader accent', () => {
  test('parses #rrggbb and rejects anything else', () => {
    expect(hexToRgb('#ff8000')).toEqual([1, 128 / 255, 0]);
    expect(hexToRgb('oklch(0.7 0.1 30)')).toBeNull();
  });

  test('every theme accent is a hex the shader can tint with', () => {
    for (const a of ACCENT_OPTIONS) expect(hexToRgb(a.value), a.id).not.toBeNull();
  });
});

describe('thinking shader styles', () => {
  test('every style assembles a full fragment shader with one main()', () => {
    for (const id of THINKING_STYLES) {
      const src = thinkingFragment(id);
      expect(src.match(/void main\(\)/g), id).toHaveLength(1);
      expect(src, id).toContain('gl_FragColor');
    }
  });
  test('the default is crystal orbs, and cel keeps its original body', () => {
    expect(DEFAULT_THINKING_STYLE).toBe('crystal');
    expect(thinkingFragment('cel')).toContain('float band = lit > 0.62');
  });
  test('only known ids are styles', () => {
    expect(isThinkingStyle('holo')).toBe(true);
    expect(isThinkingStyle('lava')).toBe(false);
    expect(isThinkingStyle(null)).toBe(false);
  });
});
