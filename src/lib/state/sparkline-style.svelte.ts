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
  get current() { return current; },
  set(s: SparklineStyle) {
    current = s;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, s);
    }
  },
};
