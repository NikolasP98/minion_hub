export interface ThemeStyle {
  /** Base letter-spacing for body text */
  letterSpacing: string;
  /** Line height multiplier */
  lineHeight: string;
  /** Border radius scale */
  radius: string;
  /** Base font weight for body text (300-400) */
  fontWeight: string;
  /** Border opacity (0-1 range, applied via alpha) */
  borderAlpha: string;
}

const DEFAULT_STYLE: ThemeStyle = {
  letterSpacing: '0em',
  lineHeight: '1.5',
  radius: '6px',
  fontWeight: '400',
  borderAlpha: '1',
};

export { DEFAULT_STYLE };

export interface ThemePreset {
  id: string;
  name: string;
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
  style?: Partial<ThemeStyle>;
}

export const ACCENT_OPTIONS = [
  { id: 'blue', label: 'Blue', value: '#3b82f6' },
  { id: 'purple', label: 'Purple', value: '#a855f7' },
  { id: 'green', label: 'Green', value: '#22c55e' },
  { id: 'cyan', label: 'Cyan', value: '#06b6d4' },
  { id: 'rose', label: 'Rose', value: '#f43f5e' },
  { id: 'amber', label: 'Amber', value: '#f59e0b' },
  { id: 'orange', label: 'Orange', value: '#f97316' },
  { id: 'emerald', label: 'Emerald', value: '#10b981' },
  { id: 'indigo', label: 'Indigo', value: '#6366f1' },
  { id: 'red', label: 'Red', value: '#ef4444' },
] as const;

export const PRESETS: ThemePreset[] = [
  {
    id: 'new-york',
    name: 'New York',
    colors: {
      bg: '#09090b',
      bg2: '#18181b',
      bg3: '#27272a',
      card: '#0c0c0e',
      cardForeground: '#fafafa',
      // White-alpha border = the "hairline" depth cue (lifts with the surface
      // in a dark UI), matching the .surface-* utilities. Council #2.
      border: 'rgba(255, 255, 255, 0.08)',
      foreground: '#fafafa',
      muted: '#a1a1aa',
      mutedForeground: '#71717a',
      accent: '#3b82f6',
      accentForeground: '#fafafa',
      brandPink: '#e8547a',
    },
  },
  {
    id: 'btop-purple',
    name: 'btop Purple',
    colors: {
      bg: '#120a1e',
      bg2: '#1a1028',
      bg3: '#2a1a3e',
      card: '#160d22',
      cardForeground: '#e8d5f5',
      border: '#3d2a55',
      foreground: '#e8d5f5',
      muted: '#a87ec4',
      mutedForeground: '#7a5a96',
      accent: '#c084fc',
      accentForeground: '#fafafa',
      brandPink: '#e879a8',
    },
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    colors: {
      bg: '#0a0a0a',
      bg2: '#141414',
      bg3: '#1f1f1f',
      card: '#0d0d0d',
      cardForeground: '#e0ffe0',
      border: '#1a3a1a',
      foreground: '#e0ffe0',
      muted: '#66bb6a',
      mutedForeground: '#388e3c',
      accent: '#00e676',
      accentForeground: '#0a0a0a',
      brandPink: '#ff4081',
    },
  },
  {
    id: 'midnight-ocean',
    name: 'Midnight Ocean',
    colors: {
      bg: '#0a1628',
      bg2: '#0f1e35',
      bg3: '#162a48',
      card: '#0c1a2e',
      cardForeground: '#e0f0ff',
      border: '#1e3a5c',
      foreground: '#e0f0ff',
      muted: '#6ba3cc',
      mutedForeground: '#4a7a9e',
      accent: '#38bdf8',
      accentForeground: '#0a1628',
      brandPink: '#f472b6',
    },
  },
  {
    id: 'voxelized',
    name: 'VOXELIZED',
    colors: {
      bg: '#030a12',
      bg2: '#080f1e',
      bg3: '#0d1a30',
      card: '#0a1428',
      cardForeground: '#d6efff',
      border: '#152d5c',
      foreground: '#e4f2ff',
      muted: '#3d6fa0',
      mutedForeground: '#6aacde',
      accent: '#00f0ff',
      accentForeground: '#000812',
      brandPink: '#ff2d78',
    },
    style: {
      radius: '0px',
      letterSpacing: '0.06em',
      lineHeight: '1.6',
      fontWeight: '400',
      borderAlpha: '1',
    },
  },
  {
    id: 'void',
    name: 'Void',
    colors: {
      bg: '#000000',
      bg2: '#050507',
      bg3: '#0c0c0f',
      card: '#030304',
      cardForeground: '#b8b8c0',
      border: '#161619',
      foreground: '#c0c0c8',
      muted: '#707078',
      mutedForeground: '#505058',
      accent: '#6366f1',
      accentForeground: '#e0e0e8',
      brandPink: '#c44d6c',
    },
    style: {
      letterSpacing: '0.025em',
      lineHeight: '1.65',
      radius: '8px',
      fontWeight: '350',
      borderAlpha: '0.6',
    },
  },
  {
    id: 'obsidian',
    name: 'Obsidian',
    colors: {
      bg: '#0c0c0c',
      bg2: '#141414',
      bg3: '#1c1c1e',
      card: '#111111',
      cardForeground: '#ececec',
      border: '#232325',
      foreground: '#e4e4e7',
      muted: '#8b8b8e',
      mutedForeground: '#5c5c60',
      accent: '#3b82f6',
      accentForeground: '#ffffff',
      brandPink: '#d4456a',
    },
    style: {
      letterSpacing: '0.01em',
      lineHeight: '1.55',
      radius: '8px',
      fontWeight: '400',
      borderAlpha: '0.7',
    },
  },
  {
    id: 'crt',
    name: 'CRT',
    colors: {
      bg: '#070501',
      bg2: '#0e0a02',
      bg3: '#160e03',
      card: '#0d0800',
      cardForeground: '#c87820',
      border: '#2e1e04',
      foreground: '#e8a030',
      muted: '#3a2606',
      mutedForeground: '#7a5820',
      accent: '#ffbe40',
      accentForeground: '#040300',
      brandPink: '#c83820',
    },
    style: {
      radius: '0px',
      letterSpacing: '0.08em',
      lineHeight: '1.6',
      fontWeight: '400',
      borderAlpha: '1',
    },
  },

  // ─── Light themes ──────────────────────────────────────────────────────────
  // Ports of the most recognizable light palettes on the market. Surfaces run
  // light→dark (bg lightest, bg2/bg3 recede) — the inverse of the dark presets —
  // and text/border values are solid so the hairline shows on a light canvas.

  {
    id: 'github-light',
    name: 'GitHub Light',
    colors: {
      bg: '#ffffff',
      bg2: '#f6f8fa',
      bg3: '#eaeef2',
      card: '#ffffff',
      cardForeground: '#1f2328',
      border: '#d0d7de',
      foreground: '#1f2328',
      muted: '#59636e',
      mutedForeground: '#818b98',
      accent: '#0969da',
      accentForeground: '#ffffff',
      brandPink: '#bf3989',
    },
    style: {
      radius: '6px',
      lineHeight: '1.5',
    },
  },
  {
    id: 'solarized-light',
    name: 'Solarized Light',
    colors: {
      bg: '#fdf6e3',
      bg2: '#f5efdc',
      bg3: '#eee8d5',
      card: '#fdf6e3',
      cardForeground: '#586e75',
      border: '#e3ddc9',
      foreground: '#586e75',
      muted: '#657b83',
      mutedForeground: '#93a1a1',
      accent: '#268bd2',
      accentForeground: '#fdf6e3',
      brandPink: '#d33682',
    },
    style: {
      radius: '5px',
      lineHeight: '1.55',
    },
  },
  {
    id: 'catppuccin-latte',
    name: 'Catppuccin Latte',
    colors: {
      bg: '#eff1f5',
      bg2: '#e6e9ef',
      bg3: '#dce0e8',
      card: '#eff1f5',
      cardForeground: '#4c4f69',
      border: '#ccd0da',
      foreground: '#4c4f69',
      muted: '#6c6f85',
      mutedForeground: '#9ca0b0',
      accent: '#1e66f5',
      accentForeground: '#eff1f5',
      brandPink: '#ea76cb',
    },
    style: {
      radius: '8px',
      lineHeight: '1.5',
    },
  },
  {
    id: 'one-light',
    name: 'One Light',
    colors: {
      bg: '#fafafa',
      bg2: '#f0f0f1',
      bg3: '#e5e5e6',
      card: '#ffffff',
      cardForeground: '#383a42',
      border: '#dbdbdc',
      foreground: '#383a42',
      muted: '#696c77',
      mutedForeground: '#a0a1a7',
      accent: '#4078f2',
      accentForeground: '#ffffff',
      brandPink: '#d94a8c',
    },
    style: {
      radius: '4px',
      lineHeight: '1.5',
    },
  },
  {
    id: 'nord-light',
    name: 'Nord Light',
    colors: {
      bg: '#eceff4',
      bg2: '#e5e9f0',
      bg3: '#d8dee9',
      card: '#eceff4',
      cardForeground: '#2e3440',
      border: '#d8dee9',
      foreground: '#2e3440',
      muted: '#4c566a',
      mutedForeground: '#9099ab',
      accent: '#5e81ac',
      accentForeground: '#eceff4',
      brandPink: '#b48ead',
    },
    style: {
      radius: '6px',
      lineHeight: '1.55',
    },
  },
];
