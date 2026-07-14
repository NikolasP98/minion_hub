import { PRESETS, ACCENT_OPTIONS } from '$lib/themes/presets';
import { syncPreferenceToServer } from './preference-sync.svelte';

export { applyTheme } from '$lib/themes/runtime';

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
  get presetId() {
    return presetId;
  },
  get accentId() {
    return accentId;
  },
  get preset() {
    return preset;
  },
  get accent() {
    return accent;
  },
  get mode(): 'light' | 'dark' {
    return preset.mode ?? 'dark';
  },
  get presets() {
    return PRESETS;
  },
  get accents() {
    return ACCENT_OPTIONS;
  },

  setPreset(id: string) {
    presetId = id;
    saveConfig({ presetId, accentId });
    syncPreferenceToServer('theme', { presetId, accentId });
  },
  setAccent(id: string) {
    accentId = id;
    saveConfig({ presetId, accentId });
    syncPreferenceToServer('theme', { presetId, accentId });
  },

  applyFromServer(data: { presetId: string; accentId: string }) {
    presetId = data.presetId;
    accentId = data.accentId;
    saveConfig({ presetId, accentId });
  },
};
