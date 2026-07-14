import { onAccentFor } from './contrast';
import type { ThemePreset } from './presets';

// Before the shared semantic preset selector became authoritative, applyTheme
// wrote a second local palette into these aliases. Remove any stale inline values
// so aliases from @minion-stack/design-tokens can resolve from one token graph.
const LEGACY_INLINE_THEME_VARIABLES = [
  '--color-bg',
  '--color-bg2',
  '--color-bg3',
  '--color-card',
  '--color-card-foreground',
  '--color-border',
  '--color-foreground',
  '--color-muted',
  '--color-muted-foreground',
  '--color-accent-foreground',
  '--color-brand',
  '--color-brand-pink',
  '--color-success',
  '--color-warning',
  '--color-destructive',
  '--color-info',
  '--color-status-running',
  '--color-status-thinking',
  '--color-status-idle',
  '--color-status-aborted',
  '--theme-letter-spacing',
  '--theme-line-height',
  '--theme-radius',
  '--theme-font-weight',
  '--theme-border-alpha',
] as const;

/** Apply the selected preset to both legacy aliases and shared semantic roles. */
export function applyTheme(p: ThemePreset, accentValue: string) {
  const root = document.documentElement;

  // PageShell, navigation, cards, and dialogs consume the shared semantic layer.
  // Selecting the preset here keeps those roles synchronized with the legacy Hub
  // aliases below instead of leaving migrated surfaces on the default dark theme.
  root.setAttribute('data-minion-theme', p.id);

  // Decorative hooks are intentionally separate from semantic token authority.
  if (p.id === 'voxelized' || p.id === 'obsidian' || p.id === 'crt') {
    root.setAttribute('data-theme', p.id);
  } else {
    root.removeAttribute('data-theme');
  }

  for (const variable of LEGACY_INLINE_THEME_VARIABLES) {
    root.style.removeProperty(variable);
  }

  const onAccent = onAccentFor(accentValue);
  root.style.setProperty('--color-accent', accentValue);
  root.style.setProperty('--color-on-accent', onAccent);

  if (p.id === 'voxelized') {
    root.style.setProperty('--vx-glow-cyan', '0, 240, 255');
    root.style.setProperty('--vx-glow-pink', '255, 45, 120');
    root.style.setProperty('--vx-glow-green', '57, 255, 20');
    root.style.setProperty('--vx-dither-dark', '#030a12');
    root.style.setProperty('--vx-dither-mid', '#071424');
    root.style.setProperty('--vx-dither-light', '#0d1e36');
  } else {
    for (const variable of [
      '--vx-glow-cyan',
      '--vx-glow-pink',
      '--vx-glow-green',
      '--vx-dither-dark',
      '--vx-dither-mid',
      '--vx-dither-light',
    ]) {
      root.style.removeProperty(variable);
    }
  }

  if (p.id === 'crt') {
    root.style.setProperty('--crt-glow-amber', '200, 120, 32');
    root.style.setProperty('--crt-glow-hot', '255, 190, 64');
    root.style.setProperty('--crt-glow-green', '64, 200, 64');
    root.style.setProperty('--crt-void', '#040300');
    root.style.setProperty('--crt-base', '#c87820');
    root.style.setProperty('--crt-bright', '#e8a030');
    root.style.setProperty('--crt-hot', '#ffbe40');
    root.style.setProperty('--crt-bloom', '#ffd060');
    root.style.setProperty('--crt-green', '#40c840');
    root.style.setProperty('--crt-red', '#c83820');
  } else {
    for (const variable of [
      '--crt-glow-amber',
      '--crt-glow-hot',
      '--crt-glow-green',
      '--crt-void',
      '--crt-base',
      '--crt-bright',
      '--crt-hot',
      '--crt-bloom',
      '--crt-green',
      '--crt-red',
    ]) {
      root.style.removeProperty(variable);
    }
  }
}
