import { syncPreferenceToServer } from './preference-sync.svelte';

export type SparklineStyle = 'area' | 'bar' | 'stepped';

export const SPARKLINE_STYLE_OPTIONS: { id: SparklineStyle; label: string; icon: string }[] = [
  { id: 'area', label: 'Area', icon: '◜' },
  { id: 'bar', label: 'Bar', icon: '▐' },
  { id: 'stepped', label: 'Stepped', icon: '⌐' },
];

const STORAGE_KEY = 'sparkline-style';

function loadStyle(): SparklineStyle {
  if (typeof localStorage === 'undefined') return 'area';
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'area' || raw === 'bar' || raw === 'stepped') return raw;
  } catch {}
  return 'area';
}

let current = $state<SparklineStyle>(loadStyle());

export const sparklineStyle = {
  get current() {
    return current;
  },
  set(s: SparklineStyle) {
    current = s;
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, s);
      } catch {
        // Storage failure is non-fatal - server sync will still happen
      }
    }
    syncPreferenceToServer('sparklineStyle', { style: s });
  },

  applyFromServer(data: { style: string }) {
    const s = data.style;
    if (s === 'area' || s === 'bar' || s === 'stepped') {
      current = s;
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(STORAGE_KEY, s);
        } catch {
          // Storage failure is non-fatal
        }
      }
    }
  },
};
