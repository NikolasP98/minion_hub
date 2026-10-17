import { describe, expect, it } from 'vitest';
import { hexToSrgb, oklabToHex, orbPalette, srgbToOklab } from './orb-color';

describe('orb colour math', () => {
  it('round-trips sRGB through OkLab', () => {
    for (const hex of ['#3b82f6', '#e11d48', '#16a34a', '#000000', '#ffffff']) {
      expect(oklabToHex(srgbToOklab(hexToSrgb(hex)!))).toBe(hex);
    }
  });

  it('matches the published OkLab value for white and a known blue', () => {
    const [L, a, b] = srgbToOklab([1, 1, 1]);
    expect(L).toBeCloseTo(1, 3);
    expect(a).toBeCloseTo(0, 3);
    expect(b).toBeCloseTo(0, 3);
    expect(srgbToOklab([0, 0, 1])[0]).toBeCloseTo(0.452, 2);
  });

  it('builds a light edge and dark eyes from the accent, with a grey fallback for bad input', () => {
    const p = orbPalette('#e11d48');
    expect(p.body).toBe('#e11d48');
    expect(p.stops[1][0]).toBeGreaterThan(0.9);
    expect(srgbToOklab(hexToSrgb(p.feature)!)[0]).toBeLessThan(0.35);
    const grey = orbPalette('not-a-colour').stops[0];
    expect(grey[1]).toBeCloseTo(0, 3);
    expect(grey[2]).toBeCloseTo(0, 3);
  });
});
