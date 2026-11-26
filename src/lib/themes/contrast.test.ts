import { describe, expect, test } from 'vitest';
import { ACCENT_OPTIONS, PRESETS } from './presets';
import {
  contrastRatio,
  onAccentFor,
  readableAccentFor,
  readableMutedFor,
  statusForegrounds,
} from './contrast';

describe('current Hub theme contrast', () => {
  test('every accent receives an AA small-text foreground', () => {
    for (const accent of ACCENT_OPTIONS) {
      expect(
        contrastRatio(accent.value, onAccentFor(accent.value)),
        accent.id,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('secondary text is readable on every preset canvas', () => {
    for (const preset of PRESETS) {
      expect(
        contrastRatio(readableMutedFor(preset), preset.colors.bg),
        preset.id,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('mode-aware status foregrounds are readable on representative canvases', () => {
    for (const preset of PRESETS) {
      const values = statusForegrounds(preset.mode ?? 'dark');
      for (const [name, color] of Object.entries(values)) {
        expect(
          contrastRatio(color, preset.colors.bg),
          `${preset.id}:${name}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  // Spec 153: the focus ring (3:1) and link text (4.5:1) take the accent's hue but must be
  // readable on every surface of every theme, for the theme's own accent and all options.
  test('the accent as focus ring and as link text is readable on every surface', () => {
    let unchanged = 0;
    let adjusted = 0;
    for (const preset of PRESETS) {
      const { bg, bg2, bg3, card } = preset.colors;
      for (const accent of [preset.colors.accent, ...ACCENT_OPTIONS.map((a) => a.value)]) {
        for (const [minimum, role] of [
          [3, 'ring'],
          [4.5, 'link'],
        ] as const) {
          const color = readableAccentFor(preset, accent, minimum);
          for (const surface of [bg, bg2, bg3, card]) {
            expect(
              contrastRatio(color, surface),
              `${preset.id} ${accent} ${role} on ${surface}`,
            ).toBeGreaterThanOrEqual(minimum);
          }
          if (color.toLowerCase() === accent.toLowerCase()) unchanged++;
          else adjusted++;
        }
      }
    }
    // Both branches are exercised: accents that already pass stay exactly as chosen.
    expect(unchanged).toBeGreaterThan(0);
    expect(adjusted).toBeGreaterThan(0);
  });

  test('an accent that already passes is returned untouched', () => {
    const preset = PRESETS[0];
    expect(readableAccentFor(preset, preset.colors.foreground, 4.5)).toBe(preset.colors.foreground);
    expect(readableAccentFor(preset, 'rgb(1 2 3)', 4.5)).toBe('rgb(1 2 3)');
  });
});
