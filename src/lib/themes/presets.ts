import designTokens from '@minion-stack/design-tokens/contract.json';

type ContractThemeId = keyof typeof designTokens.themes;
type ContractAccentId = keyof typeof designTokens.accentOptions;

export interface ThemePreset {
  id: ContractThemeId;
  name: string;
  mode: 'light' | 'dark';
  typographyStyle: string;
  colors: {
    bg: string;
    bg2: string;
    bg3: string;
    card: string;
    cardForeground: string;
    border: string;
    foreground: string;
    muted: string;
    mutedForeground: string;
    accent: string;
    accentForeground: string;
    brandPink: string;
  };
}

const THEME_ORDER: ContractThemeId[] = [
  'new-york',
  'btop-purple',
  'cyberpunk',
  'midnight-ocean',
  'voxelized',
  'void',
  'obsidian',
  'crt',
  'github-light',
  'solarized-light',
  'catppuccin-latte',
  'one-light',
  'nord-light',
  'rose-pine-dawn',
  'gruvbox-light',
  'ayu-light',
];

const ACCENT_ORDER: ContractAccentId[] = [
  'blue',
  'purple',
  'green',
  'cyan',
  'rose',
  'amber',
  'orange',
  'emerald',
  'indigo',
  'red',
];

const ACCENT_LABELS: Record<ContractAccentId, string> = {
  blue: 'Blue',
  purple: 'Purple',
  green: 'Green',
  cyan: 'Cyan',
  rose: 'Rose',
  amber: 'Amber',
  orange: 'Orange',
  emerald: 'Emerald',
  indigo: 'Indigo',
  red: 'Red',
};

export const ACCENT_OPTIONS = ACCENT_ORDER.map((id) => ({
  id,
  label: ACCENT_LABELS[id],
  value: designTokens.accentOptions[id].accent,
}));

// Compatibility-shaped view of the shared semantic contract. Theme previews,
// contrast checks, and legacy alias consumers now read the exact same palette
// that tokens.css activates through data-minion-theme.
export const PRESETS: ThemePreset[] = THEME_ORDER.map((id) => {
  const theme = designTokens.themes[id];
  return {
    id,
    name: theme.name,
    mode: theme.mode as ThemePreset['mode'],
    typographyStyle: theme.typographyStyle,
    colors: {
      bg: theme.colors.canvas,
      bg2: theme.colors.surface1,
      bg3: theme.colors.surface2,
      card: theme.colors.surface2,
      cardForeground: theme.colors.textPrimary,
      border: theme.colors.borderDefault,
      foreground: theme.colors.textPrimary,
      muted: theme.colors.textSecondary,
      mutedForeground: theme.colors.textTertiary,
      accent: theme.colors.accent,
      accentForeground: theme.colors.onAccent,
      brandPink: theme.colors.brand,
    },
  };
});
