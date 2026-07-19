// Per-user, per-dashboard control config: which quick ranges appear as pills and
// which one is the default window. Client-only (localStorage) and always
// fail-soft — a dashboard must render even if storage is unavailable.
import { type RangeId, DEFAULT_VISIBLE_RANGES, orderRangeIds } from './ranges';

export interface RangeConfig {
  visible: RangeId[];
  default: RangeId | null;
}

const keyFor = (storageKey: string) => `dash-range-cfg:${storageKey}`;

export function defaultRangeConfig(visible: RangeId[] = DEFAULT_VISIBLE_RANGES): RangeConfig {
  return { visible: [...visible], default: null };
}

export function loadRangeConfig(
  storageKey: string,
  fallbackVisible: RangeId[] = DEFAULT_VISIBLE_RANGES,
): RangeConfig {
  const fallback = defaultRangeConfig(fallbackVisible);
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(keyFor(storageKey));
    if (!raw) return fallback;
    const cfg = JSON.parse(raw) as Partial<RangeConfig>;
    const visible =
      Array.isArray(cfg.visible) && cfg.visible.length
        ? orderRangeIds(cfg.visible)
        : fallback.visible;
    return {
      visible: visible.length ? visible : fallback.visible,
      default: typeof cfg.default === 'string' ? cfg.default : null,
    };
  } catch {
    return fallback;
  }
}

export function saveRangeConfig(storageKey: string, cfg: RangeConfig): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(keyFor(storageKey), JSON.stringify(cfg));
  } catch {
    /* quota/private-mode — config is a convenience, never block the UI */
  }
}

/** Toggle a range's pill visibility. Keeps ≥1 visible; hiding clears the default. */
export function toggleRangeVisible(cfg: RangeConfig, id: RangeId): RangeConfig {
  if (cfg.visible.includes(id)) {
    if (cfg.visible.length <= 1) return cfg;
    return {
      visible: cfg.visible.filter((x) => x !== id),
      default: cfg.default === id ? null : cfg.default,
    };
  }
  return { ...cfg, visible: orderRangeIds([...cfg.visible, id]) };
}

/** Set (or unset, when re-picked) the default range; a default is always visible. */
export function setDefaultRange(cfg: RangeConfig, id: RangeId): RangeConfig {
  const next = cfg.default === id ? null : id;
  if (!next) return { ...cfg, default: null };
  return { visible: orderRangeIds([...cfg.visible, id]), default: next };
}
