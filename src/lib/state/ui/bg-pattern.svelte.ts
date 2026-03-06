/** Reactive background pattern state — persisted to localStorage */

const STORAGE_KEY = 'minion-hub-bg-pattern';

export type PatternType = 'none' | 'dots' | 'grid' | 'crosses' | 'diagonal' | 'hexagons';

export interface BgPatternConfig {
  pattern: PatternType;
  opacity: number;   // 0–100
  size: number;       // 8–48 (gap in px)
}

const DEFAULTS: BgPatternConfig = { pattern: 'dots', opacity: 8, size: 18 };

function load(): BgPatternConfig {
  if (typeof localStorage === 'undefined') return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULTS };
}

function save(cfg: BgPatternConfig) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

const initial = load();
let pattern = $state<PatternType>(initial.pattern);
let opacity = $state(initial.opacity);
let size = $state(initial.size);

export const bgPattern = {
  get pattern() { return pattern; },
  get opacity() { return opacity; },
  get size() { return size; },

  setPattern(p: PatternType) { pattern = p; save({ pattern, opacity, size }); },
  setOpacity(v: number) { opacity = v; save({ pattern, opacity, size }); },
  setSize(v: number) { size = v; save({ pattern, opacity, size }); },
};

export const PATTERN_OPTIONS: { id: PatternType; label: string; icon: string }[] = [
  { id: 'none', label: 'None', icon: '∅' },
  { id: 'dots', label: 'Dots', icon: '⠿' },
  { id: 'grid', label: 'Grid', icon: '⊞' },
  { id: 'crosses', label: 'Crosses', icon: '✛' },
  { id: 'diagonal', label: 'Diagonal', icon: '╱' },
  { id: 'hexagons', label: 'Hex', icon: '⬡' },
];
