import { describe, expect, test } from 'vitest';
import { ACCENT_OPTIONS } from '$lib/themes/presets';
import { hexToRgb } from './thinking-shader';

describe('thinking shader accent', () => {
  test('parses #rrggbb and rejects anything else', () => {
    expect(hexToRgb('#ff8000')).toEqual([1, 128 / 255, 0]);
    expect(hexToRgb('oklch(0.7 0.1 30)')).toBeNull();
  });

  test('every theme accent is a hex the shader can tint with', () => {
    for (const a of ACCENT_OPTIONS) expect(hexToRgb(a.value), a.id).not.toBeNull();
  });
});
