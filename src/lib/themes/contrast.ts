import type { ThemePreset } from './presets';

type Rgb = readonly [number, number, number];

function rgb(hex: string): Rgb | null {
  const value = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(value)) return null;
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

function channel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(color: Rgb): number {
  return 0.2126 * channel(color[0]) + 0.7152 * channel(color[1]) + 0.0722 * channel(color[2]);
}

export function contrastRatio(a: string, b: string): number {
  const first = rgb(a);
  const second = rgb(b);
  if (!first || !second) return 1;
  const light = Math.max(luminance(first), luminance(second));
  const dark = Math.min(luminance(first), luminance(second));
  return (light + 0.05) / (dark + 0.05);
}

/**
 * Pick the neutral for text/icons painted on the accent. White is preferred —
 * black-on-saturated-accent reads muddy even when it scores higher — and black
 * is used only when white cannot clear WCAG AA (bright accents: amber, cyan, …).
 */
export function onAccentFor(accent: string): '#000000' | '#ffffff' {
  return contrastRatio(accent, '#ffffff') >= 4.5 ? '#ffffff' : '#000000';
}

function toHex(color: Rgb): string {
  return `#${color.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
}

function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  return [
    from[0] + (to[0] - from[0]) * amount,
    from[1] + (to[1] - from[1]) * amount,
    from[2] + (to[2] - from[2]) * amount,
  ];
}

/**
 * Preserve each preset's hue while ensuring secondary text remains readable.
 * Non-hex values are returned unchanged because the browser may resolve them.
 */
export function readableMutedFor(preset: ThemePreset, minimum = 4.5): string {
  const candidate = preset.colors.mutedForeground;
  if (contrastRatio(candidate, preset.colors.bg) >= minimum) return candidate;
  const start = rgb(candidate);
  const target = rgb(preset.colors.foreground);
  if (!start || !target) return preset.colors.foreground;
  for (let amount = 0.05; amount <= 1; amount += 0.05) {
    const adjusted = toHex(mix(start, target, amount));
    if (contrastRatio(adjusted, preset.colors.bg) >= minimum) return adjusted;
  }
  return preset.colors.foreground;
}

export function statusForegrounds(mode: 'light' | 'dark') {
  return mode === 'light'
    ? {
        success: '#166534',
        warning: '#92400e',
        destructive: '#b91c1c',
        info: '#1d4ed8',
        running: '#166534',
        thinking: '#92400e',
        idle: '#52525b',
        aborted: '#b91c1c',
      }
    : {
        success: '#4ade80',
        warning: '#fbbf24',
        destructive: '#f87171',
        info: '#60a5fa',
        running: '#4ade80',
        thinking: '#fbbf24',
        idle: '#a1a1aa',
        aborted: '#f87171',
      };
}
