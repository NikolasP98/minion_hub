const KEY = 'minion-hub-reliability-filters';
const PRESETS = new Set(['1h', '24h', '7d', '30d']);
const TABS = new Set(['overview', 'agents', 'plugins', 'insights', 'performance', 'architecture']);
export interface PersistedReliabilityFilters {
  categories: string[];
  severities: string[];
  failureModes?: string[];
  datePreset: string | null;
  customFrom?: number;
  customTo?: number;
  tab?: string;
  scope?: 'all' | 'global' | 'org';
}
const defaults = (): PersistedReliabilityFilters => ({
  categories: [],
  severities: [],
  datePreset: '24h',
});
const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? [
        ...new Set(
          value.filter(
            (item): item is string =>
              typeof item === 'string' && item.length > 0 && item.length <= 128,
          ),
        ),
      ].slice(0, 100)
    : [];

/** Accessing window.localStorage itself may throw in restricted browser contexts. */
export function readReliabilityFilters(
  storage: () => Storage | undefined = () =>
    typeof window === 'undefined' ? undefined : window.localStorage,
): { filters: PersistedReliabilityFilters; unavailable: boolean } {
  try {
    const raw = storage()?.getItem(KEY);
    if (!raw) return { filters: defaults(), unavailable: false };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('Invalid saved filters');
    const value = parsed as Record<string, unknown>;
    const validRange =
      typeof value.customFrom === 'number' &&
      Number.isFinite(value.customFrom) &&
      typeof value.customTo === 'number' &&
      Number.isFinite(value.customTo) &&
      value.customFrom <= value.customTo;
    return {
      filters: {
        categories: strings(value.categories),
        severities: strings(value.severities),
        failureModes: strings(value.failureModes),
        datePreset:
          typeof value.datePreset === 'string' && PRESETS.has(value.datePreset)
            ? value.datePreset
            : validRange
              ? null
              : '24h',
        ...(validRange
          ? { customFrom: value.customFrom as number, customTo: value.customTo as number }
          : {}),
        tab: typeof value.tab === 'string' && TABS.has(value.tab) ? value.tab : 'overview',
        scope: value.scope === 'global' || value.scope === 'org' ? value.scope : 'all',
      },
      unavailable: false,
    };
  } catch {
    return { filters: defaults(), unavailable: true };
  }
}
export function writeReliabilityFilters(
  filters: PersistedReliabilityFilters,
  storage: () => Storage | undefined = () =>
    typeof window === 'undefined' ? undefined : window.localStorage,
): boolean {
  try {
    const target = storage();
    if (!target) return false;
    target.setItem(KEY, JSON.stringify(filters));
    return true;
  } catch {
    return false;
  }
}
