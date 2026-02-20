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
      border: '#27272a',
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
];
