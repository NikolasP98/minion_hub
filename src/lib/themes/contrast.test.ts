import { describe, expect, test } from 'vitest';
import { ACCENT_OPTIONS, PRESETS } from './presets';
import { contrastRatio, onAccentFor, readableMutedFor, statusForegrounds } from './contrast';

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
});
