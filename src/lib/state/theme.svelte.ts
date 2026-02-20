import { PRESETS, ACCENT_OPTIONS, DEFAULT_STYLE, type ThemePreset } from '$lib/themes/presets';

const STORAGE_KEY = 'minion-hub-theme';

interface ThemeConfig {
  presetId: string;
  accentId: string;
}

function loadConfig(): ThemeConfig {
  if (typeof localStorage === 'undefined') return { presetId: 'new-york', accentId: 'blue' };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { presetId: 'new-york', accentId: 'blue' };
}

function saveConfig(cfg: ThemeConfig) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

const initial = loadConfig();
let presetId = $state(initial.presetId);
let accentId = $state(initial.accentId);

const preset = $derived(PRESETS.find((p) => p.id === presetId) ?? PRESETS[0]);
const accent = $derived(ACCENT_OPTIONS.find((a) => a.id === accentId) ?? ACCENT_OPTIONS[0]);

export const theme = {
  get presetId() { return presetId; },
  get accentId() { return accentId; },
  get preset() { return preset; },
  get accent() { return accent; },
  get presets() { return PRESETS; },
  get accents() { return ACCENT_OPTIONS; },

  setPreset(id: string) {
    presetId = id;
    saveConfig({ presetId, accentId });
  },
  setAccent(id: string) {
    accentId = id;
    saveConfig({ presetId, accentId });
  },
};

/** Apply theme CSS variables to :root — call in root layout $effect */
export function applyTheme(p: ThemePreset, accentValue: string) {
  const root = document.documentElement;

  // Colors
  root.style.setProperty('--color-bg', p.colors.bg);
  root.style.setProperty('--color-bg2', p.colors.bg2);
  root.style.setProperty('--color-bg3', p.colors.bg3);
  root.style.setProperty('--color-card', p.colors.card);
  root.style.setProperty('--color-card-foreground', p.colors.cardForeground);
  root.style.setProperty('--color-border', p.colors.border);
  root.style.setProperty('--color-foreground', p.colors.foreground);
  root.style.setProperty('--color-muted', p.colors.muted);
  root.style.setProperty('--color-muted-foreground', p.colors.mutedForeground);
  root.style.setProperty('--color-accent', accentValue);
  root.style.setProperty('--color-accent-foreground', p.colors.accentForeground);
  root.style.setProperty('--color-brand-pink', p.colors.brandPink);

  // Style overrides (typography, spacing)
  const s = { ...DEFAULT_STYLE, ...p.style };
  root.style.setProperty('--theme-letter-spacing', s.letterSpacing);
  root.style.setProperty('--theme-line-height', s.lineHeight);
  root.style.setProperty('--theme-radius', s.radius);
  root.style.setProperty('--theme-font-weight', s.fontWeight);
  root.style.setProperty('--theme-border-alpha', s.borderAlpha);
}
